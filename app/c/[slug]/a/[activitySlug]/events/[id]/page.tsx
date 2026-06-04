'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { useActivity } from '@/lib/use-activity';
import { shuffle, formatTime12, windForGame, assignPlayersToTables, WIND_LABEL, type Wind } from '@/lib/game-utils';
import { formatAddressLines } from '@/lib/address';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';
import { PullToRefresh } from '@/components/PullToRefresh';
import { ToastProvider, useToast, InlineConfirm, type ConfirmOptions } from '@/components/Toast';
import {
  notifySignupCreated,
  notifySignupWithdrawn,
  notifySignupApproved,
  notifyPlayerAdded,
  notifyPlayerRemoved,
} from '@/app/actions/notifications';
import { sendEventReminderNow } from '@/app/actions/reminders';
import { sendCalendarInvites } from '@/app/actions/send-invites';
import {
  sendEventInvitations,
  acceptEventInvitation,
  declineEventInvitation,
  cancelEventInvitation,
} from '@/app/actions/event-invites';

type Night = {
  id: string;
  club_id: string;
  name: string;
  date: string;
  start_time: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  host_player_id: string | null;
  num_tables: number;
  games_planned: number;
  status: string;
  visibility: 'normal' | 'hidden';
};
type EventInvite = {
  id: string;
  invitee_user_id: string;
  invitee_name: string | null;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
};
type Member = {
  user_id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
type Signup = { id: string; player_id: string; status: 'approved' | 'pending'; created_at?: string; invited_at?: string | null };
type Table = { id: string; table_number: number; assigned: boolean };
type Seat = { id: string; table_id: string; player_id: string; wind: Wind | null };
type Game = { id: string; table_id: string; game_number: number; status: string };
type Score = { id: string; game_id: string; player_id: string; points: number; is_winner: boolean };
type GPW = { game_id: string; player_id: string; wind: Wind | null; is_sitting_out: boolean };

export default function EventDetailPage() {
  return (
    <ToastProvider>
      <EventDetailPageInner />
    </ToastProvider>
  );
}

function EventDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const clubSlug = params.slug as string;
  const activitySlug = params.activitySlug as string;
  const id = params.id as string;
  const supabase = getBrowserSupabase();
  const auth = useAuth();
  const cb = useClub(clubSlug);
  const act = useActivity(cb.club?.id, activitySlug);
  const { toast, confirm } = useToast();

  const eventBasePath = `/c/${clubSlug}/a/${activitySlug}/events`;

  const [night, setNight] = useState<Night | null>(null);
  const [host, setHost] = useState<Member | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [scores, setScores] = useState<Record<string, Score[]>>({});
  const [gpws, setGpws] = useState<Record<string, GPW[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState<{ tableId: string; gameId: string } | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState<{ seatId: string; tableId: string } | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  // Pro state — used to gate the outside-email invite input. Server gate
  // is still authoritative.
  const [isPro, setIsPro] = useState<boolean | null>(null);
  // Spinner state for the "Send reminder" button.
  const [sendingReminder, setSendingReminder] = useState(false);

  // Event invitations (for hidden events). Loaded for everyone but the UI
  // only acts on them when relevant (banner for pending invitees; manage
  // section for admins/host).
  const [eventInvites, setEventInvites] = useState<EventInvite[]>([]);
  // Spinner states for invitation actions
  const [respondingToInvite, setRespondingToInvite] = useState(false);
  const [inviteActionError, setInviteActionError] = useState<string | null>(null);
  // Manage-invitations UI state (admins/host)
  const [showAddInvitesPanel, setShowAddInvitesPanel] = useState(false);
  const [addInviteMemberIds, setAddInviteMemberIds] = useState<Set<string>>(new Set());
  const [addInviteEmails, setAddInviteEmails] = useState('');
  const [addInviteWelcome, setAddInviteWelcome] = useState('');
  const [sendingMoreInvites, setSendingMoreInvites] = useState(false);

  const load = useCallback(async () => {
    if (!cb.club) return;
    setLoading(true);

    const [nightRes, tablesRes, signupsRes, membersRes, invitesRes, subRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).eq('club_id', cb.club.id).single(),
      supabase.from('tables').select('*').eq('event_id', id).order('table_number'),
      supabase.from('night_signups').select('id, player_id, status, created_at, invited_at').eq('event_id', id),
      supabase.from('club_members')
        .select('user_id, user:user_id(name, street, city, state, zip, deleted_at)')
        .eq('club_id', cb.club.id),
      // event_invites with the invitee's name joined in. RLS hides invites
      // the caller can't see (non-admin non-invitee members see nothing).
      supabase.from('event_invites')
        .select('id, invitee_user_id, status, created_at, responded_at, invitee:invitee_user_id(name)')
        .eq('event_id', id)
        .order('created_at', { ascending: true }),
      // Subscription state for gating UI on Pro-only features.
      supabase.from('club_subscriptions')
        .select('status, current_period_end')
        .eq('club_id', cb.club.id)
        .maybeSingle(),
    ]);

    // Derive Pro flag (mirrors DB club_is_pro logic)
    const subData = subRes.data as any;
    const proStatuses = ['active', 'trialing', 'grandfathered', 'past_due'];
    const pro = subData && (
      proStatuses.includes(subData.status) ||
      (subData.status === 'canceled' && subData.current_period_end &&
       new Date(subData.current_period_end) > new Date())
    );
    setIsPro(!!pro);

    setNight(nightRes.data as unknown as Night);
    setTables((tablesRes.data as Table[]) || []);
    setSignups((signupsRes.data as Signup[]) || []);

    // Map invitee_user_id → name from join; keep the rest as-is
    const invitesData: EventInvite[] = ((invitesRes.data as any[]) || []).map((r) => ({
      id: r.id,
      invitee_user_id: r.invitee_user_id,
      invitee_name: r.invitee?.name ?? null,
      status: r.status,
      created_at: r.created_at,
      responded_at: r.responded_at,
    }));
    setEventInvites(invitesData);

    const mList: Member[] = ((membersRes.data as any[]) || [])
      .filter((m) => m.user && !m.user.deleted_at)
      .map((m) => ({
        user_id: m.user_id,
        name: m.user.name,
        street: m.user.street, city: m.user.city, state: m.user.state, zip: m.user.zip,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setMembers(mList);

    if ((nightRes.data as any)?.host_player_id) {
      const h = mList.find((m) => m.user_id === (nightRes.data as any).host_player_id);
      setHost(h || null);
    } else {
      setHost(null);
    }

    const tableIds = ((tablesRes.data as any[]) || []).map((t) => t.id);
    if (tableIds.length === 0) {
      setSeats([]); setGames([]); setScores({}); setGpws({}); setLoading(false); return;
    }

    const [seatsRes, gamesRes] = await Promise.all([
      supabase.from('table_seats').select('*').in('table_id', tableIds),
      supabase.from('games').select('*').in('table_id', tableIds).order('game_number'),
    ]);
    setSeats((seatsRes.data as Seat[]) || []);
    setGames((gamesRes.data as Game[]) || []);

    const gameIds = ((gamesRes.data as any[]) || []).map((g) => g.id);
    const scoresMap: Record<string, Score[]> = {};
    const gpwMap: Record<string, GPW[]> = {};
    if (gameIds.length > 0) {
      const [scoresRes, gpwRes] = await Promise.all([
        supabase.from('game_scores').select('*').in('game_id', gameIds),
        supabase.from('game_player_winds').select('*').in('game_id', gameIds),
      ]);
      ((scoresRes.data as any[]) || []).forEach((s) => {
        if (!scoresMap[s.game_id]) scoresMap[s.game_id] = [];
        scoresMap[s.game_id].push(s);
      });
      ((gpwRes.data as any[]) || []).forEach((g) => {
        if (!gpwMap[g.game_id]) gpwMap[g.game_id] = [];
        gpwMap[g.game_id].push(g);
      });
    }
    setScores(scoresMap);
    setGpws(gpwMap);
    setLoading(false);
  }, [id, supabase, cb.club]);

  useEffect(() => { if (cb.club) load(); }, [cb.club, load]);
  // Re-fetch on tab/PWA focus so the view picks up signups, score changes,
  // and other concurrent edits without manual refresh.
  useRefreshOnFocus(load, !!cb.club);

  if (cb.loading || !cb.club) return null;
  if (loading) return <p className="text-ink/40 italic">Loading game night…</p>;
  if (!night) return <p className="text-ink/40 italic">Game night not found.</p>;

  const isHost = !!auth.userId && night.host_player_id === auth.userId;
  const canManage = isHost || cb.isAdmin;
  const isAssigned = tables.some((t) => t.assigned);

  // Split signups into approved (count toward capacity, get tables, see street)
  // vs pending (awaiting host approval — public events only).
  const approvedSignups = signups.filter((s) => s.status === 'approved');
  const pendingSignups = signups.filter((s) => s.status === 'pending');
  const approvedIds = new Set(approvedSignups.map((s) => s.player_id));
  const userApproved = !!auth.userId && approvedIds.has(auth.userId);
  const userPending = !!auth.userId && pendingSignups.some((s) => s.player_id === auth.userId);
  const userSignedUp = userApproved || userPending;

  // Event-invitation derived state. The user's own invitation, if any.
  // Pending = banner shown; accepted = treated as a regular signup; declined
  // = the page wouldn't have loaded for them via RLS (filtered out).
  const myInvite = auth.userId ? eventInvites.find((i) => i.invitee_user_id === auth.userId) : undefined;
  const isPendingInvitee = myInvite?.status === 'pending';
  const isHiddenEvent = night.visibility === 'hidden';

  // Sort invites for the admin "Manage invitations" panel.
  const pendingInvitesList = eventInvites.filter((i) => i.status === 'pending');
  const acceptedInvitesList = eventInvites.filter((i) => i.status === 'accepted');
  const declinedInvitesList = eventInvites.filter((i) => i.status === 'declined');

  // Is this a public event? (Activity AND club both public.)
  // The activity is public iff act.activity.is_public; the club is public
  // iff cb.club.is_public.
  const isPublicEvent = !!(act.activity?.is_public && cb.club?.is_public);

  // Can this user see the street address?
  //   - Always for club members
  //   - For non-members: only if they have an approved signup
  const canSeeStreet = cb.isMember || userApproved;

  const capacityMin = night.num_tables * 4;
  const capacityMax = night.num_tables * 5;
  // Capacity check uses approved only — pending signups don't reserve seats.
  const approvedCount = approvedSignups.length;

  // --- ACTIONS ---

  async function claimHost() {
    if (!auth.userId || !night) return;
    const claimer = members.find((m) => m.user_id === auth.userId);
    const nightHasAddress = !!(night.street || night.city || night.state || night.zip);
    const updates: any = { host_player_id: auth.userId };
    if (!nightHasAddress && claimer) {
      updates.street = claimer.street;
      updates.city = claimer.city;
      updates.state = claimer.state;
      updates.zip = claimer.zip;
    }
    // For public events without city/state info, warn the user before submitting
    // (the DB trigger would reject otherwise).
    if (isPublicEvent) {
      const proposedCity = updates.city ?? night.city;
      const proposedState = updates.state ?? night.state;
      if (!proposedCity || !proposedState) {
        toast(
          'This is a public event, which requires city and state. Set those on your profile or on the event before claiming host.',
          'error'
        );
        return;
      }
    }
    const { error } = await supabase.from('events').update(updates).eq('id', id);
    if (error) toast(error.message, 'error'); else load();
  }

  async function releaseHost() {
    const { error } = await supabase.from('events').update({ host_player_id: null }).eq('id', id);
    if (error) toast(error.message, 'error'); else load();
  }

  async function selfSignup() {
    if (!auth.userId || !cb.club) return;
    // For club members, auto-approve (status='approved'). For non-members
    // signing up to a public event, status='pending' — host must approve.
    const status: 'approved' | 'pending' = cb.isMember ? 'approved' : 'pending';
    if (status === 'approved' && approvedCount >= capacityMax) {
      toast('Signups are full.', 'info');
      return;
    }
    const { data, error } = await supabase.from('night_signups').insert({
      club_id: cb.club.id,
      event_id: id,
      player_id: auth.userId,
      status,
    }).select('id').single();
    if (error) { toast(error.message, 'error'); return; }
    // Notify the host (fire and forget; load() will not wait on this)
    if (data?.id) {
      notifySignupCreated(data.id as string, status).catch(() => {});
    }
    toast(status === 'pending' ? 'Request sent — awaiting host approval' : 'You’re signed up ✓', status === 'pending' ? 'info' : 'success');
    load();
  }

  async function selfWithdraw() {
    if (!auth.userId) return;
    const withdrawnUserId = auth.userId;
    const { error } = await supabase.from('night_signups').delete().eq('event_id', id).eq('player_id', auth.userId);
    if (error) { toast(error.message, 'error'); return; }
    notifySignupWithdrawn(id, withdrawnUserId).catch(() => {});
    toast('Withdrawn from this event', 'info');
    load();
  }

  async function approvePending(signupId: string) {
    if (!cb.club) return;
    // Capacity sanity check (host could be trying to approve into a full event)
    if (approvedCount >= capacityMax) {
      const ok = await confirm({
        title: 'Over capacity',
        message: `The event is already at capacity (${capacityMax}). Approve anyway? It'll be over capacity.`,
        confirmLabel: 'Approve anyway',
      });
      if (!ok) return;
    }
    const { error } = await supabase
      .from('night_signups')
      .update({ status: 'approved' })
      .eq('id', signupId);
    if (error) { toast(error.message, 'error'); return; }
    notifySignupApproved(signupId).catch(() => {});
    load();
  }

  async function declinePending(signupId: string) {
    const { error } = await supabase
      .from('night_signups')
      .delete()
      .eq('id', signupId);
    if (error) toast(error.message, 'error'); else load();
  }

  async function handleSendReminder() {
    if (sendingReminder) return;
    // Confirm because pushing notifications to a bunch of people is not
    // something to do by accident. Day-of reminders go out automatically
    // each morning anyway — this is for the "I added more attendees, push
    // again" case or testing.
    const ok = await confirm({
      title: 'Send reminder?',
      message: `Send a reminder push to all approved attendees for "${night?.name}"?`,
      confirmLabel: 'Send',
    });
    if (!ok) return;
    setSendingReminder(true);
    try {
      const res = await sendEventReminderNow(id);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      const { pushesDelivered, attendeesAttempted } = res;
      if (attendeesAttempted === 0) {
        toast('No approved attendees to remind.', 'info');
      } else if (pushesDelivered === 0) {
        toast('Sent — but no devices received it (attendees may not have push enabled).', 'info');
      } else {
        toast(`Reminder sent — ${pushesDelivered} device${pushesDelivered === 1 ? '' : 's'} ✓`, 'success');
      }
    } catch (e: any) {
      toast(e?.message ?? 'Reminder failed.', 'error');
    } finally {
      setSendingReminder(false);
    }
  }

  // -------- Event invitation handlers --------

  async function handleAcceptInvite() {
    if (respondingToInvite) return;
    setInviteActionError(null);
    setRespondingToInvite(true);
    try {
      const res = await acceptEventInvitation(id);
      if (!res.ok) {
        setInviteActionError(res.error);
        return;
      }
      // Refetch to pick up the new signup row + invite status
      await load();
      toast(`You're in for "${night?.name}" ✓`, 'success');
    } catch (e: any) {
      setInviteActionError(e?.message || 'Failed to accept invitation.');
    } finally {
      setRespondingToInvite(false);
    }
  }

  async function handleDeclineInvite() {
    if (respondingToInvite) return;
    const ok = await confirm({
      title: 'Decline invitation?',
      message: `Decline the invitation to "${night?.name}"? This event will disappear from your view.`,
      confirmLabel: 'Decline',
      tone: 'danger',
    });
    if (!ok) return;
    setInviteActionError(null);
    setRespondingToInvite(true);
    try {
      const res = await declineEventInvitation(id);
      if (!res.ok) {
        setInviteActionError(res.error);
        setRespondingToInvite(false);
        return;
      }
      // Event becomes invisible to us — redirect home
      router.push('/');
    } catch (e: any) {
      setInviteActionError(e?.message || 'Failed to decline invitation.');
      setRespondingToInvite(false);
    }
  }

  async function handleCancelInvite(inviteId: string, name: string | null) {
    const ok = await confirm({
      title: 'Cancel invitation?',
      message: `Cancel invitation${name ? ` to ${name}` : ''}?`,
      confirmLabel: 'Cancel invitation',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    const res = await cancelEventInvitation(inviteId);
    if (!res.ok) {
      toast(res.error, 'error');
      return;
    }
    await load();
  }

  async function handleSendMoreInvites() {
    if (sendingMoreInvites) return;
    const memberIds = Array.from(addInviteMemberIds);
    const outsideEmails = addInviteEmails
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (memberIds.length === 0 && outsideEmails.length === 0) {
      toast('Pick at least one member or enter at least one email.', 'info');
      return;
    }
    setSendingMoreInvites(true);
    try {
      const res = await sendEventInvitations({
        eventId: id,
        memberUserIds: memberIds,
        outsideEmails,
        welcomeMessage: addInviteWelcome.trim() || undefined,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      const data = res.data!;
      const parts: string[] = [];
      if (data.membersInvited > 0) parts.push(`${data.membersInvited} member${data.membersInvited === 1 ? '' : 's'}`);
      if (data.outsideEmailsSent > 0) parts.push(`${data.outsideEmailsSent} outside email${data.outsideEmailsSent === 1 ? '' : 's'}`);
      toast(parts.length > 0 ? `Invited ${parts.join(' + ')} ✓` : 'No new invitations sent.', parts.length > 0 ? 'success' : 'info');
      // Reset the form + reload
      setAddInviteMemberIds(new Set());
      setAddInviteEmails('');
      setAddInviteWelcome('');
      setShowAddInvitesPanel(false);
      await load();
    } catch (e: any) {
      toast(e?.message || 'Failed to send invitations.', 'error');
    } finally {
      setSendingMoreInvites(false);
    }
  }

  async function addPlayer(playerId: string) {
    if (!cb.club) return;
    const { error } = await supabase.from('night_signups').insert({
      club_id: cb.club.id,
      event_id: id,
      player_id: playerId,
      status: 'approved',  // host-added members bypass any approval flow
    });
    if (error) { toast(error.message, 'error'); return; }
    notifyPlayerAdded(id, playerId).catch(() => {});
    setShowAddPlayer(false);
    load();
  }

  async function removePlayer(playerId: string) {
    const { error } = await supabase.from('night_signups').delete().eq('event_id', id).eq('player_id', playerId);
    if (error) { toast(error.message, 'error'); return; }
    notifyPlayerRemoved(id, playerId).catch(() => {});
    load();
  }

  async function assignTables() {
    if (!night || !cb.club) return;
    if (approvedCount < capacityMin) { toast(`Need at least ${capacityMin} approved players to assign tables.`, 'info'); return; }
    if (approvedCount > capacityMax) { toast(`Too many players. Max is ${capacityMax}.`, 'info'); return; }
    if (isAssigned) {
      const ok = await confirm({
        title: 'Re-seat the tables?',
        message: 'This shuffles everyone into fresh seats for any games not yet scored. Games you’ve already scored stay exactly as they are.',
        confirmLabel: 'Re-seat',
        cancelLabel: 'Keep current',
      });
      if (!ok) return;
    }

    const total = approvedCount;
    const fivePlayerTables = total - capacityMin;
    const tableSizes: (4 | 5)[] = Array.from({ length: night.num_tables }, (_, i) =>
      i < fivePlayerTables ? 5 : 4
    );

    // Pull lifetime sit-out counts for the signed-up players in this league
    // so we can balance assignments. People with the fewest historical
    // sit-outs go to 5-player tables tonight; everyone else gets shielded
    // at 4-player tables.
    const signupIds = approvedSignups.map((s) => s.player_id);
    const sitOutCounts = new Map<string, number>();
    if (signupIds.length > 0) {
      const { data: histRows } = await supabase
        .from('game_player_winds')
        .select('player_id')
        .eq('club_id', cb.club.id)
        .eq('is_sitting_out', true)
        .in('player_id', signupIds);
      ((histRows as any[]) || []).forEach((r) => {
        sitOutCounts.set(r.player_id, (sitOutCounts.get(r.player_id) ?? 0) + 1);
      });
    }
    const playersByTable = assignPlayersToTables(signupIds, tableSizes, sitOutCounts, night.games_planned);

    try {
      const tableIds = tables.map((t) => t.id);
      const { data: existingGames } = await supabase.from('games').select('id, status').in('table_id', tableIds);
      const pendingGameIds = ((existingGames as any[]) || []).filter((g) => g.status === 'pending').map((g) => g.id);

      if (pendingGameIds.length > 0) {
        await supabase.from('game_player_winds').delete().in('game_id', pendingGameIds);
        await supabase.from('game_scores').delete().in('game_id', pendingGameIds);
        await supabase.from('games').delete().in('id', pendingGameIds);
      }
      await supabase.from('table_seats').delete().in('table_id', tableIds);

      const seatsPayload: { club_id: string; table_id: string; player_id: string; wind: Wind | null }[] = [];
      const winds: Wind[] = ['E', 'S', 'W', 'N'];
      tables.forEach((table, ti) => {
        const sizeForThisTable = tableSizes[ti];
        // playersByTable[ti] is already shuffled within the table by assignPlayersToTables
        playersByTable[ti].forEach((pid, pos) => {
          const wind = pos < 4 ? winds[pos] : null;
          seatsPayload.push({ club_id: cb.club!.id, table_id: table.id, player_id: pid, wind });
        });
      });
      if (seatsPayload.length > 0) {
        const { error: seatsErr } = await supabase.from('table_seats').insert(seatsPayload);
        if (seatsErr) throw seatsErr;
      }

      await Promise.all(tables.map((t) => supabase.from('tables').update({ assigned: true }).eq('id', t.id)));

      const newGames: { club_id: string; table_id: string; game_number: number; status: string }[] = [];
      tables.forEach((table) => {
        for (let gn = 1; gn <= night.games_planned; gn++) {
          newGames.push({ club_id: cb.club!.id, table_id: table.id, game_number: gn, status: 'pending' });
        }
      });
      const { data: insertedGames, error: gamesErr } = await supabase.from('games').insert(newGames).select();
      if (gamesErr) throw gamesErr;

      const gpwPayload: { club_id: string; game_id: string; player_id: string; wind: Wind | null; is_sitting_out: boolean }[] = [];
      tables.forEach((table, ti) => {
        const size = tableSizes[ti];
        const tableSeats = seatsPayload.filter((s) => s.table_id === table.id);
        const positionByPlayer = new Map<string, number>();
        tableSeats.forEach((s, pos) => positionByPlayer.set(s.player_id, pos));
        const tableGames = ((insertedGames as any[]) || []).filter((g) => g.table_id === table.id);
        tableGames.forEach((g) => {
          tableSeats.forEach((s) => {
            const pos = positionByPlayer.get(s.player_id)!;
            const wind = windForGame(pos, g.game_number, size);
            gpwPayload.push({
              club_id: cb.club!.id,
              game_id: g.id,
              player_id: s.player_id,
              wind,
              is_sitting_out: wind === null,
            });
          });
        });
      });
      if (gpwPayload.length > 0) {
        const { error: gpwErr } = await supabase.from('game_player_winds').insert(gpwPayload);
        if (gpwErr) throw gpwErr;
      }

      await load();
      toast(isAssigned ? 'Tables re-seated ✓' : 'Tables assigned ✓', 'success');
    } catch (e: any) {
      toast('Failed to assign tables: ' + e.message, 'error');
    }
  }

  async function swapPlayer(seatId: string, newPlayerId: string) {
    if (!cb.club) return;
    const seat = seats.find((s) => s.id === seatId);
    if (!seat) return;
    const oldPlayerId = seat.player_id;

    const { error: seatErr } = await supabase.from('table_seats').update({ player_id: newPlayerId }).eq('id', seatId);
    if (seatErr) { toast(seatErr.message, 'error'); return; }

    const tableGameIds = games.filter((g) => g.table_id === seat.table_id && g.status === 'pending').map((g) => g.id);
    if (tableGameIds.length > 0) {
      await supabase.from('game_player_winds').delete().in('game_id', tableGameIds).eq('player_id', newPlayerId);
      await supabase.from('game_player_winds').update({ player_id: newPlayerId }).in('game_id', tableGameIds).eq('player_id', oldPlayerId);
    }

    if (!approvedIds.has(newPlayerId)) {
      await supabase.from('night_signups').insert({
        club_id: cb.club.id,
        event_id: id,
        player_id: newPlayerId,
        status: 'approved',
      });
    }
    await supabase.from('night_signups').delete().eq('event_id', id).eq('player_id', oldPlayerId);

    setShowSwapModal(null);
    load();
  }

  async function completeNight() {
    const ok = await confirm({
      title: 'End the night?',
      message: 'Mark this game night completed. You can reopen it later if you need to.',
      confirmLabel: 'End night',
    });
    if (!ok) return;
    await supabase.from('events').update({ status: 'completed' }).eq('id', id);
    load();
  }
  async function reopenNight() {
    await supabase.from('events').update({ status: 'active' }).eq('id', id);
    load();
  }

  // --- RENDER ---
  // For public events, non-members without an approved signup don't get
  // the street. Build the address display from a possibly-redacted copy.
  const displayedNight = canSeeStreet ? night : { ...night, street: null };
  const addressLines = formatAddressLines(displayedNight);
  const streetIsHidden = !canSeeStreet && !!night.street;

  return (
    <>
      <PullToRefresh onRefresh={load}>
    <div className="space-y-12">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-2">
            {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {night.start_time && <span className="ml-2">· {formatTime12(night.start_time)}</span>}
            {isHiddenEvent && (
              <span className="ml-3 inline-block px-2 py-0.5 bg-cinnabar/10 text-cinnabar border border-cinnabar/30 normal-case tracking-[0.15em]">
                Hidden
              </span>
            )}
          </p>
          <h1 className="font-display text-5xl md:text-6xl">{night.name}</h1>
          <div className="mt-4 text-ink/60 space-y-1">
            <div>
              {host ? <>Hosted by <strong>{host.name}</strong></> : <span className="text-cinnabar/80 italic">Awaiting a host</span>}
            </div>
            {addressLines.length > 0 && (
              <div className="text-sm">
                {addressLines.map((line, idx) => <div key={idx}>{line}</div>)}
                {streetIsHidden && (
                  <div className="text-xs italic text-ink/40 mt-1">
                    Street address shown after the host approves your signup.
                  </div>
                )}
              </div>
            )}
            <div className="text-sm">
              {night.num_tables} table{night.num_tables === 1 ? '' : 's'} · {night.games_planned} games each ·{' '}
              <span className={night.status === 'active' ? 'text-jade' : 'text-ink/40'}>{night.status}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!host && auth.userId && cb.isMember && (
            <button onClick={claimHost} className="btn btn-jade">Host this night</button>
          )}
          {canManage && host && (
            <InlineConfirm
              confirmLabel="Release"
              onConfirm={releaseHost}
              render={(arm) => (
                <button onClick={arm} className="btn btn-ghost text-xs">Release host</button>
              )}
            />
          )}
          {canManage && night.status === 'active' && <button onClick={completeNight} className="btn">End Night</button>}
          {canManage && night.status === 'completed' && <button onClick={reopenNight} className="btn btn-ghost">Reopen</button>}
        </div>
      </header>

      {/* INVITATION BANNER — shown to a pending invitee. Big and prominent
          so it's the first thing they see. Hidden once they accept or decline. */}
      {isPendingInvitee && (
        <section className="tile-border p-6 md:p-8 bg-cinnabar/5 border-cinnabar/40">
          <p className="text-xs tracking-[0.3em] uppercase text-cinnabar mb-2">You&apos;re invited</p>
          <h2 className="font-display text-2xl md:text-3xl mb-3">Will you join us?</h2>
          <p className="text-sm text-ink/70 mb-5">
            You&apos;ve been invited to this event. Accept to confirm your attendance, or decline to remove it from your view.
          </p>
          {inviteActionError && (
            <p className="text-cinnabar text-sm mb-3">{inviteActionError}</p>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleAcceptInvite}
              disabled={respondingToInvite}
              className="btn btn-jade"
            >
              {respondingToInvite ? 'Working…' : 'Accept'}
            </button>
            <button
              onClick={handleDeclineInvite}
              disabled={respondingToInvite}
              className="btn btn-ghost"
            >
              Decline
            </button>
          </div>
        </section>
      )}

      {/* SIGNUPS */}
      <section className="tile-border p-6 md:p-8">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-3xl">Signed Up</h2>
            <p className="text-sm text-ink/50 italic mt-1">
              {approvedCount} / {capacityMax} · need {capacityMin} to play
              {pendingSignups.length > 0 && (
                <> · <span className="text-cinnabar">{pendingSignups.length} pending approval</span></>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Member signup: auto-approved */}
            {auth.userId && cb.isMember && !userSignedUp && approvedCount < capacityMax && (
              <button onClick={selfSignup} className="btn btn-jade">Sign me up</button>
            )}
            {/* Non-member signup for public event: pending approval */}
            {auth.userId && !cb.isMember && isPublicEvent && !userSignedUp && (
              <button onClick={selfSignup} className="btn btn-jade">Request to join</button>
            )}
            {auth.userId && userApproved && !isAssigned && (
              <button onClick={selfWithdraw} className="btn btn-ghost text-xs">Withdraw</button>
            )}
            {auth.userId && userPending && (
              <button onClick={selfWithdraw} className="btn btn-ghost text-xs">Cancel request</button>
            )}
            {canManage && (
              <button onClick={() => setShowAddPlayer(true)} className="btn btn-ghost text-xs">+ Add player</button>
            )}
            {canManage && approvedSignups.length > 0 && (
              <button onClick={() => setShowInviteModal(true)} className="btn btn-ghost text-xs">
                Calendar invites
              </button>
            )}
            {canManage && approvedSignups.length > 0 && (
              <button onClick={handleSendReminder} disabled={sendingReminder} className="btn btn-ghost text-xs">
                {sendingReminder ? 'Sending…' : 'Send reminder'}
              </button>
            )}
          </div>
        </div>

        {/* User's own pending state callout */}
        {userPending && (
          <div className="border border-cinnabar/30 bg-cinnabar/5 p-4 mb-5 text-sm">
            Your request to join is awaiting host approval. You'll see the full address once approved.
          </div>
        )}

        {/* Pending list (host/admin view only) */}
        {canManage && pendingSignups.length > 0 && (
          <div className="mb-6 border-l-2 border-cinnabar pl-4">
            <div className="text-xs tracking-[0.2em] uppercase text-cinnabar mb-3">
              Pending Approval ({pendingSignups.length})
            </div>
            <ul className="divide-y divide-ink/10">
              {pendingSignups.map((s) => {
                const member = members.find((m) => m.user_id === s.player_id);
                // Non-members aren't in club_members, so name lookup fails. Show their user info.
                return (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm">
                      <span className="font-medium">{member?.name || `User ${s.player_id.slice(0, 8)}`}</span>
                      {!member && <span className="text-ink/40 ml-2 text-xs italic">not a club member</span>}
                    </span>
                    <span className="flex gap-2 items-center">
                      <button
                        onClick={() => approvePending(s.id)}
                        className="text-xs tracking-[0.15em] uppercase text-jade hover:underline"
                      >
                        Approve
                      </button>
                      <InlineConfirm
                        confirmLabel="Decline"
                        onConfirm={() => declinePending(s.id)}
                        render={(arm) => (
                          <button
                            onClick={arm}
                            className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
                          >
                            Decline
                          </button>
                        )}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {approvedSignups.length === 0 ? (
          <p className="text-ink/40 italic">No one's signed up yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {approvedSignups.map((s) => {
              const member = members.find((m) => m.user_id === s.player_id);
              const isSeated = seats.some((seat) => seat.player_id === s.player_id);
              return (
                <span
                  key={s.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm border ${
                    isSeated ? 'bg-jade/10 border-jade/30' : 'bg-bone/60 border-ink/15'
                  }`}
                >
                  <span>{member?.name || '—'}</span>
                  {canManage && !isAssigned && (
                    <InlineConfirm
                      confirmLabel="Remove"
                      onConfirm={() => removePlayer(s.player_id)}
                      render={(arm) => (
                        <button
                          onClick={arm}
                          className="text-ink/30 hover:text-cinnabar text-xs"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    />
                  )}
                </span>
              );
            })}
          </div>
        )}

        {canManage && (
          <div className="mt-7 pt-5 border-t border-ink/10 flex flex-wrap items-center gap-4">
            <button
              onClick={assignTables}
              className="btn btn-jade"
              disabled={approvedCount < capacityMin || approvedCount > capacityMax}
            >
              {isAssigned ? 'Re-assign Tables' : 'Assign Tables'}
            </button>
            <p className="text-xs text-ink/50 italic">
              {approvedCount < capacityMin
                ? `${capacityMin - approvedCount} more player${capacityMin - approvedCount === 1 ? '' : 's'} needed.`
                : approvedCount > capacityMax
                ? `${approvedCount - capacityMax} too many. Remove some.`
                : (
                  <>
                    Seating balances sit-outs over the season.{' '}
                    <details className="inline">
                      <summary className="inline cursor-pointer text-ink/60 hover:text-ink underline">How does this work?</summary>
                      <span className="block mt-1 not-italic text-ink/50">
                        Players who have sat out the least land at 5-player tables, and within those,
                        the least-sat are seated to sit out games 1{night.games_planned >= 2 ? `–${Math.min(night.games_planned, 5)}` : ''}.
                      </span>
                    </details>
                  </>
                )}
            </p>
          </div>
        )}
      </section>

      {/* MANAGE INVITATIONS — admin/host only, only shown on hidden events.
          Lists pending/accepted/declined invitees, lets admin cancel pendings
          and add more invitations.

          For non-hidden events, this section isn't shown (not needed). */}
      {canManage && isHiddenEvent && (
        <section className="tile-border p-6 md:p-8">
          <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
            <div>
              <h2 className="font-display text-3xl">Invitations</h2>
              <p className="text-sm text-ink/50 italic mt-1">
                {pendingInvitesList.length} pending · {acceptedInvitesList.length} accepted
                {declinedInvitesList.length > 0 && <> · {declinedInvitesList.length} declined</>}
              </p>
            </div>
            <button
              onClick={() => setShowAddInvitesPanel((v) => !v)}
              className="btn btn-ghost text-xs"
            >
              {showAddInvitesPanel ? 'Close' : '+ Invite more'}
            </button>
          </div>

          {/* Add more invitations panel */}
          {showAddInvitesPanel && (
            <div className="border border-ink/15 p-4 mb-5 space-y-4 bg-bone">
              <div>
                <label className="label">Invite club members</label>
                <p className="text-xs text-ink/40 italic mb-2">
                  {addInviteMemberIds.size === 0
                    ? 'Select members not yet invited.'
                    : `${addInviteMemberIds.size} selected`}
                </p>
                {(() => {
                  // Filter out members who already have an invite or are signed up
                  const alreadyInvitedIds = new Set(eventInvites.map((i) => i.invitee_user_id));
                  const eligibleMembers = members.filter((m) =>
                    !alreadyInvitedIds.has(m.user_id) && !approvedIds.has(m.user_id)
                  );
                  if (eligibleMembers.length === 0) {
                    return <p className="text-xs text-ink/50 italic">All club members are already invited or signed up.</p>;
                  }
                  return (
                    <div className="max-h-48 overflow-y-auto border border-ink/15 p-2 space-y-1">
                      {eligibleMembers.map((m) => (
                        <label key={m.user_id} className="flex items-center gap-2 cursor-pointer hover:bg-ink/5 px-2 py-1 text-sm">
                          <input
                            type="checkbox"
                            checked={addInviteMemberIds.has(m.user_id)}
                            onChange={(e) => {
                              setAddInviteMemberIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(m.user_id);
                                else next.delete(m.user_id);
                                return next;
                              });
                            }}
                            className="accent-jade w-4 h-4"
                          />
                          <span>{m.name}</span>
                        </label>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="label flex items-center gap-2">
                  Outside guests <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span>
                  {isPro === false && (
                    <span className="text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 bg-cinnabar/10 border border-cinnabar/40 text-cinnabar font-normal">
                      Pro
                    </span>
                  )}
                </label>
                {isPro === false ? (
                  <div className="border border-ink/10 bg-ink/[0.02] p-3 text-sm text-ink/60">
                    Email invitations to people outside the club require Pro.{' '}
                    <Link href={`/c/${cb.club!.slug}/billing`} className="text-cinnabar hover:underline">
                      Upgrade to Pro
                    </Link>{' '}
                    to invite non-members via email.
                  </div>
                ) : (
                  <>
                    <textarea
                      className="input min-h-[60px] font-mono text-sm"
                      value={addInviteEmails}
                      onChange={(e) => setAddInviteEmails(e.target.value)}
                      placeholder="sarah@example.com&#10;tom@example.com"
                    />
                    <p className="text-xs text-ink/40 italic mt-1">
                      Email addresses, one per line. They&apos;ll join the club + event in one click.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="label">
                  Welcome message <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span>
                </label>
                <textarea
                  className="input min-h-[50px]"
                  value={addInviteWelcome}
                  onChange={(e) => setAddInviteWelcome(e.target.value)}
                  placeholder="A note for outside guests (sent in their email)."
                  maxLength={2000}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSendMoreInvites}
                  disabled={sendingMoreInvites}
                  className="btn btn-jade text-sm"
                >
                  {sendingMoreInvites ? 'Sending…' : 'Send invitations'}
                </button>
                <button
                  onClick={() => {
                    setShowAddInvitesPanel(false);
                    setAddInviteMemberIds(new Set());
                    setAddInviteEmails('');
                    setAddInviteWelcome('');
                  }}
                  className="btn btn-ghost text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* List of current invitations */}
          {eventInvites.length === 0 ? (
            <p className="text-sm text-ink/50 italic">No invitations sent yet.</p>
          ) : (
            <div className="space-y-1">
              {/* Pending first */}
              {pendingInvitesList.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2 px-3 border-b border-ink/5 last:border-0">
                  <div className="min-w-0">
                    <span className="text-sm">{inv.invitee_name || '(name unavailable)'}</span>
                    <span className="ml-2 text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border bg-cinnabar/10 border-cinnabar/30 text-cinnabar">Pending</span>
                  </div>
                  <InlineConfirm
                    confirmLabel="Cancel invitation"
                    onConfirm={() => handleCancelInvite(inv.id, inv.invitee_name)}
                    render={(arm) => (
                      <button
                        onClick={arm}
                        className="text-xs text-ink/50 hover:text-cinnabar"
                      >
                        Cancel
                      </button>
                    )}
                  />
                </div>
              ))}
              {/* Accepted */}
              {acceptedInvitesList.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2 px-3 border-b border-ink/5 last:border-0">
                  <div className="min-w-0">
                    <span className="text-sm">{inv.invitee_name || '(name unavailable)'}</span>
                    <span className="ml-2 text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border bg-jade/10 border-jade/40 text-jade">Accepted</span>
                  </div>
                </div>
              ))}
              {/* Declined */}
              {declinedInvitesList.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2 px-3 border-b border-ink/5 last:border-0 opacity-60">
                  <div className="min-w-0">
                    <span className="text-sm">{inv.invitee_name || '(name unavailable)'}</span>
                    <span className="ml-2 text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border border-ink/20 text-ink/50">Declined</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isAssigned && (
        <div className="space-y-10">
          {tables.map((table) => {
            const tableSeats = seats.filter((s) => s.table_id === table.id);
            const tableGames = games.filter((g) => g.table_id === table.id);
            return (
              <TableSection
                key={table.id}
                table={table}
                seats={tableSeats}
                games={tableGames}
                scores={scores}
                gpws={gpws}
                members={members}
                canManage={canManage}
                onOpenGame={(gameId) => setActiveGame({ tableId: table.id, gameId })}
                onSwapSeat={(seatId) => setShowSwapModal({ seatId, tableId: table.id })}
              />
            );
          })}
        </div>
      )}

      {showInviteModal && (
        <CalendarInviteModal
          eventId={id}
          eventName={night.name}
          downloadUrl={`${eventBasePath}/${id}/invite.ics`}
          recipients={approvedSignups
            // Exclude the host themselves — they organize the event and
            // shouldn't receive a self-invite. (Gmail refuses to render
            // when ORGANIZER == ATTENDEE == recipient.)
            .filter((s) => s.player_id !== night.host_player_id)
            .map((s) => {
              const m = members.find((mm) => mm.user_id === s.player_id);
              return {
                signupId: s.id,
                name: m?.name || '—',
                email: '',  // we don't expose emails to the client UI
                invitedAt: s.invited_at ?? null,
              };
            })}
          onClose={() => setShowInviteModal(false)}
          onSuccess={(sentCount) => {
            // Close immediately on success — load() below would otherwise
            // unmount the modal anyway. Show a toast on the page so the user
            // gets the confirmation after the page settles.
            setShowInviteModal(false);
            toast(`Calendar invites sent to ${sentCount} ✓`, 'success');
            load();
          }}
        />
      )}

      {showAddPlayer && (
        <AddPlayerModal
          members={members.filter((m) => !approvedIds.has(m.user_id))}
          onClose={() => setShowAddPlayer(false)}
          onAdd={addPlayer}
        />
      )}

      {showSwapModal && (
        <SwapPlayerModal
          currentSeat={seats.find((s) => s.id === showSwapModal.seatId)!}
          members={members}
          seatedPlayerIds={new Set(seats.map((s) => s.player_id))}
          onClose={() => setShowSwapModal(null)}
          onSwap={(newPlayerId) => swapPlayer(showSwapModal.seatId, newPlayerId)}
        />
      )}

      {activeGame && (
        <ScoreEntryModal
          gameId={activeGame.gameId}
          tableSeats={seats.filter((s) => s.table_id === activeGame.tableId)}
          gpws={gpws[activeGame.gameId] || []}
          members={members}
          existingScores={scores[activeGame.gameId] || []}
          confirm={confirm}
          toast={toast}
          onClose={() => setActiveGame(null)}
          onSaved={async () => { setActiveGame(null); await load(); }}
        />
      )}
    </div>
      </PullToRefresh>
    </>
  );
}

// ============================================================
function TableSection({
  table, seats, games, scores, gpws, members, canManage, onOpenGame, onSwapSeat,
}: {
  table: Table;
  seats: Seat[];
  games: Game[];
  scores: Record<string, Score[]>;
  gpws: Record<string, GPW[]>;
  members: Member[];
  canManage: boolean;
  onOpenGame: (gameId: string) => void;
  onSwapSeat: (seatId: string) => void;
}) {
  const playerTotals = seats.map((s) => {
    const member = members.find((m) => m.user_id === s.player_id);
    let pts = 0; let wins = 0;
    games.forEach((g) => {
      const sc = (scores[g.id] || []).find((x) => x.player_id === s.player_id);
      if (sc) { pts += sc.points; if (sc.is_winner) wins++; }
    });
    return { seat: s, member, pts, wins };
  });
  playerTotals.sort((a, b) => b.wins - a.wins || b.pts - a.pts);

  return (
    <section className="tile-border p-6 md:p-8">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h2 className="font-display text-3xl">Table <em className="text-jade">{table.table_number}</em></h2>
        <span className="text-xs tracking-[0.2em] uppercase text-ink/40">{seats.length} seated</span>
      </div>

      <div className={`grid grid-cols-2 ${seats.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3 mb-7`}>
        {playerTotals.map((p) => (
          <div key={p.seat.id} className="border border-ink/10 bg-bone/50 p-3 text-center relative group">
            <div className="text-[10px] tracking-[0.2em] uppercase text-cinnabar mb-1">
              {p.seat.wind ? WIND_LABEL[p.seat.wind] : 'Sit-out (G1)'}
            </div>
            <div className="text-xs tracking-[0.15em] uppercase text-ink/60 truncate">{p.member?.name || '—'}</div>
            <div className="font-display text-3xl mt-1">{p.pts}</div>
            <div className="text-[10px] tracking-[0.15em] uppercase text-jade mt-1">{p.wins} win{p.wins === 1 ? '' : 's'}</div>
            {canManage && (
              <button
                onClick={() => onSwapSeat(p.seat.id)}
                className="absolute top-1 right-1 text-[10px] tracking-[0.15em] uppercase text-ink/30 hover:text-cinnabar opacity-0 group-hover:opacity-100 transition-opacity"
                title="Swap player"
              >
                swap
              </button>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Games</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {games.map((g) => {
            const completed = g.status === 'completed';
            const sitOut = (gpws[g.id] || []).find((x) => x.is_sitting_out);
            const sitOutMember = sitOut ? members.find((m) => m.user_id === sitOut.player_id) : null;
            const tally = scores[g.id] || [];
            const winner = tally.find((s) => s.is_winner);
            const winnerName = winner ? members.find((m) => m.user_id === winner.player_id)?.name : null;
            // A completed game with no winner = wall
            const isWall = completed && !winner && tally.length > 0;
            return (
              <button
                key={g.id}
                onClick={() => onOpenGame(g.id)}
                className={`p-3 text-left border transition-all ${
                  isWall
                    ? 'bg-cinnabar/10 border-cinnabar/30 hover:border-cinnabar'
                    : completed
                      ? 'bg-jade/10 border-jade/30 hover:border-jade'
                      : 'bg-bone border-ink/15 hover:border-ink'
                }`}
              >
                <div className="text-[10px] tracking-[0.2em] uppercase text-ink/50">Game {g.game_number}</div>
                {isWall ? (
                  <div className="mt-1 text-sm font-medium font-display italic text-cinnabar">The Wall</div>
                ) : completed && winnerName ? (
                  <>
                    <div className="mt-1 text-sm font-medium truncate">{winnerName} ✓</div>
                    {winner && winner.points > 0 && (
                      <div className="text-[10px] text-ink/50">{winner.points} pts</div>
                    )}
                  </>
                ) : completed ? (
                  <div className="mt-1 text-sm italic text-ink/50">scored</div>
                ) : (
                  <div className="mt-1 text-sm italic text-ink/40">enter</div>
                )}
                {sitOutMember && (
                  <div className="text-[10px] text-ink/40 mt-1 truncate">out: {sitOutMember.name}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================
function AddPlayerModal({
  members, onClose, onAdd,
}: { members: Member[]; onClose: () => void; onAdd: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const filtered = members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-md p-7 max-h-[80vh] flex flex-col">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Add Player</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>
        <input type="search" className="input mb-4" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-ink/40 italic text-sm">No members to add.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {filtered.map((m) => (
                <li key={m.user_id}>
                  <button onClick={() => onAdd(m.user_id)} className="w-full text-left py-3 hover:text-cinnabar">
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
function SwapPlayerModal({
  currentSeat, members, seatedPlayerIds, onClose, onSwap,
}: {
  currentSeat: Seat; members: Member[]; seatedPlayerIds: Set<string>;
  onClose: () => void; onSwap: (newPlayerId: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const currentMember = members.find((m) => m.user_id === currentSeat.player_id);
  const candidates = members.filter(
    (m) => m.user_id !== currentSeat.player_id && !seatedPlayerIds.has(m.user_id) && m.name.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-md p-7 max-h-[80vh] flex flex-col">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Swap Player</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>
        <p className="text-sm text-ink/60 mb-4">
          Replace <strong>{currentMember?.name}</strong> with another player. Wind and remaining games transfer over. Completed games keep the original scorer.
        </p>
        <input type="search" className="input mb-4" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <div className="flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-ink/40 italic text-sm">No eligible players. All others are already seated.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {candidates.map((m) => (
                <li key={m.user_id}>
                  <button onClick={() => onSwap(m.user_id)} className="w-full text-left py-3 hover:text-cinnabar">
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
function ScoreEntryModal({
  gameId, tableSeats, gpws, members, existingScores, confirm, toast, onClose, onSaved,
}: {
  gameId: string; tableSeats: Seat[]; gpws: GPW[]; members: Member[];
  existingScores: Score[];
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, variant?: 'success' | 'error' | 'info') => void;
  onClose: () => void; onSaved: () => void;
}) {
  const supabase = getBrowserSupabase();

  const playingPlayers = tableSeats
    .map((s) => {
      const gpw = gpws.find((g) => g.player_id === s.player_id);
      return { seat: s, gpw, member: members.find((m) => m.user_id === s.player_id) };
    })
    .filter((x) => x.gpw && !x.gpw.is_sitting_out);

  const sitOut = tableSeats
    .map((s) => {
      const gpw = gpws.find((g) => g.player_id === s.player_id);
      return { seat: s, gpw, member: members.find((m) => m.user_id === s.player_id) };
    })
    .find((x) => x.gpw?.is_sitting_out);

  // Existing state interpretation:
  //   - is_winner=true on any row → "winner" outcome, that player won with their points
  //   - completed game with no is_winner → "wall"
  //   - no existing scores → pending; default to no choice yet
  const existingWinner = existingScores.find((s) => s.is_winner);
  const hasExistingCompleted = existingScores.length > 0;
  const initialOutcome: 'winner' | 'wall' | null = existingWinner
    ? 'winner'
    : hasExistingCompleted
      ? 'wall'
      : null;

  const [outcome, setOutcome] = useState<'winner' | 'wall' | null>(initialOutcome);
  const [winnerId, setWinnerId] = useState<string>(existingWinner?.player_id ?? '');
  const [pointsStr, setPointsStr] = useState<string>(existingWinner ? String(existingWinner.points) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (outcome === null) { setError('Choose Winner or The Wall.'); return; }
    if (outcome === 'winner') {
      if (!winnerId) { setError('Pick the winner.'); return; }
      const parsed = parseInt(pointsStr, 10);
      if (!Number.isFinite(parsed) || parsed < 0) { setError('Enter a non-negative point total for the winner.'); return; }
    }

    setSaving(true);
    try {
      // Resolve league_id for inserts
      let leagueId: string | undefined;
      if (existingScores.length > 0) leagueId = (existingScores[0] as any).league_id;
      if (!leagueId) {
        const { data: g } = await supabase.from('games').select('league_id').eq('id', gameId).single();
        leagueId = (g as any)?.league_id;
      }
      if (!leagueId) throw new Error('Could not resolve league for this game');

      // Wipe existing scores for this game and re-insert under the new model
      await supabase.from('game_scores').delete().eq('game_id', gameId);

      const payload = playingPlayers.map(({ seat }) => {
        const isWinner = outcome === 'winner' && seat.player_id === winnerId;
        const points = isWinner ? parseInt(pointsStr, 10) : 0;
        return {
          league_id: leagueId,
          game_id: gameId,
          player_id: seat.player_id,
          points,
          is_winner: isWinner,
        };
      });
      const { error: insErr } = await supabase.from('game_scores').insert(payload);
      if (insErr) throw insErr;
      await supabase.from('games').update({ status: 'completed' }).eq('id', gameId);
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function clearAndClose() {
    const ok = await confirm({
      title: 'Clear this result?',
      message: 'This clears the recorded result and sets the game back to unscored.',
      confirmLabel: 'Clear result',
      tone: 'danger',
    });
    if (!ok) return;
    await supabase.from('game_scores').delete().eq('game_id', gameId);
    await supabase.from('games').update({ status: 'pending' }).eq('id', gameId);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-lg pt-7 px-7 pb-0 max-h-[90vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-display text-3xl">Game Result</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>

        {sitOut && (
          <p className="text-xs tracking-[0.15em] uppercase text-cinnabar mb-5">
            Sitting out · {sitOut.member?.name}
          </p>
        )}

        <p className="text-sm text-ink/50 italic mb-2">How did this hand end?</p>
        {hasExistingCompleted && (
          <p className="text-xs text-jade mb-6 not-italic">Editing a saved result — changes overwrite what's recorded.</p>
        )}
        {!hasExistingCompleted && <div className="mb-6" />}

        {/* Outcome selector */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setOutcome('winner')}
            className={`p-4 border text-left transition-colors ${
              outcome === 'winner'
                ? 'bg-jade/10 border-jade text-ink'
                : 'bg-bone border-ink/15 hover:border-ink/40 text-ink/70'
            }`}
          >
            <div className="font-display text-xl">A Winner</div>
            <div className="text-xs text-ink/50 italic mt-1">One player took the hand</div>
          </button>
          <button
            type="button"
            onClick={() => setOutcome('wall')}
            className={`p-4 border text-left transition-colors ${
              outcome === 'wall'
                ? 'bg-cinnabar/10 border-cinnabar text-ink'
                : 'bg-bone border-ink/15 hover:border-ink/40 text-ink/70'
            }`}
          >
            <div className="font-display text-xl">The Wall</div>
            <div className="text-xs text-ink/50 italic mt-1">Tiles ran out — no winner</div>
          </button>
        </div>

        {/* Winner details */}
        {outcome === 'winner' && (
          <div className="space-y-4 fade-up mb-6">
            <div>
              <label className="label">Winner</label>
              <div className="grid grid-cols-2 gap-2">
                {playingPlayers.map(({ seat, gpw, member }) => (
                  <button
                    key={seat.player_id}
                    type="button"
                    onClick={() => setWinnerId(seat.player_id)}
                    className={`p-3 border text-left transition-colors ${
                      winnerId === seat.player_id
                        ? 'bg-jade/10 border-jade'
                        : 'bg-bone border-ink/15 hover:border-ink/40'
                    }`}
                  >
                    <div className="font-medium truncate">{member?.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-cinnabar">
                      {gpw?.wind && WIND_LABEL[gpw.wind]}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Points</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="input font-display text-2xl text-right"
                value={pointsStr}
                onChange={(e) => setPointsStr(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="text-xs text-ink/40 italic mt-1">Only the winner scores. No negatives.</p>
            </div>
          </div>
        )}

        {outcome === 'wall' && (
          <div className="border border-cinnabar/30 bg-cinnabar/5 p-4 mb-6 fade-up">
            <p className="text-sm text-ink/70">
              The wall ended the hand. No points awarded. The game still counts as played for everyone at the table.
            </p>
          </div>
        )}

        {error && <p className="text-cinnabar text-sm mb-3">{error}</p>}

        {/* Sticky action bar — stays reachable without scrolling on a phone,
            since this is the highest-frequency live-night action. */}
        <div className="sticky bottom-0 -mx-7 px-7 py-4 bg-bone border-t border-ink/10 flex flex-wrap gap-3">
          <button onClick={save} className="btn btn-jade flex-1 justify-center" disabled={saving || outcome === null}>
            {saving ? 'Saving…' : 'Save Result'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          {hasExistingCompleted && (
            <button onClick={clearAndClose} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar ml-auto self-center">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type InviteRecipient = {
  signupId: string;
  name: string;
  email: string;
  invitedAt: string | null;
};

function CalendarInviteModal({
  eventId,
  eventName,
  downloadUrl,
  recipients,
  onClose,
  onSuccess,
}: {
  eventId: string;
  eventName: string;
  downloadUrl: string;
  recipients: InviteRecipient[];
  onClose: () => void;
  /** Called on fully successful send with the sent count. The parent should
   * close the modal and refresh data. Modal will NOT call onClose itself in
   * this case. */
  onSuccess: (sentCount: number) => void;
}) {
  const [customMessage, setCustomMessage] = useState('');
  const [sendMode, setSendMode] = useState<'all' | 'remaining'>('remaining');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; message: string }>(null);

  const remaining = recipients.filter((r) => !r.invitedAt);
  const alreadyInvited = recipients.filter((r) => r.invitedAt);

  // If there's nobody remaining (everyone has been invited), default to "all"
  // so the host's only option does something useful (resend).
  useEffect(() => {
    if (remaining.length === 0) setSendMode('all');
  }, [remaining.length]);

  const recipientsForThisSend =
    sendMode === 'remaining' ? remaining : recipients;

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      // Dynamic import so the server action ships only when needed
      const res = await sendCalendarInvites({
        eventId,
        customMessage: customMessage.trim() || undefined,
        onlySignupIds: sendMode === 'remaining' ? remaining.map((r) => r.signupId) : undefined,
      });
      if (!res.ok) {
        setResult({ ok: false, message: res.error });
      } else {
        const everyoneSent = res.failedCount === 0 && res.sentCount > 0;
        const parts = [
          everyoneSent
            ? `Sent to ${res.sentCount} ✓`
            : `Sent to ${res.sentCount}.`,
        ];
        if (res.failedCount > 0) parts.push(`${res.failedCount} failed.`);
        setResult({ ok: everyoneSent, message: parts.join(' ') });
        if (everyoneSent) {
          // Parent handles closing the modal + showing toast + refreshing
          // data. Don't update local state here — the modal is about to
          // unmount anyway.
          onSuccess(res.sentCount);
        }
        // For partial failures (some sent, some failed), stay open with the
        // result message so the host can see what happened.
      }
    } catch (e: any) {
      setResult({ ok: false, message: e.message || 'Send failed.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-xl p-7 max-h-[90vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-display text-3xl">Calendar Invites</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>
        <p className="text-sm text-ink/50 italic mb-6">
          Send an email + .ics file to approved players for <em>{eventName}</em>.
        </p>

        {/* Recipient status summary */}
        <div className="border-b border-ink/10 pb-4 mb-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs tracking-[0.15em] uppercase text-ink/40 mb-1">Approved players</div>
            <div className="font-display text-2xl">{recipients.length}</div>
          </div>
          <div>
            <div className="text-xs tracking-[0.15em] uppercase text-ink/40 mb-1">Not yet invited</div>
            <div className={`font-display text-2xl ${remaining.length > 0 ? 'text-cinnabar' : ''}`}>{remaining.length}</div>
          </div>
        </div>

        {alreadyInvited.length > 0 && (
          <details className="mb-4 text-sm">
            <summary className="text-xs tracking-[0.2em] uppercase text-ink/40 cursor-pointer hover:text-ink">
              {alreadyInvited.length} already invited
            </summary>
            <ul className="mt-2 pl-4 text-ink/60 space-y-0.5">
              {alreadyInvited.map((r) => (
                <li key={r.signupId} className="flex items-baseline justify-between gap-3">
                  <span>{r.name}</span>
                  <span className="text-[10px] tracking-[0.15em] uppercase text-ink/40">
                    {new Date(r.invitedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Send-mode selector — only shown if both options would do something */}
        {remaining.length > 0 && alreadyInvited.length > 0 && (
          <div className="mb-5 flex flex-col gap-2">
            <label className="flex items-baseline gap-2 cursor-pointer">
              <input
                type="radio"
                checked={sendMode === 'remaining'}
                onChange={() => setSendMode('remaining')}
                className="accent-jade"
              />
              <span className="text-sm">
                Send to {remaining.length} not yet invited
              </span>
            </label>
            <label className="flex items-baseline gap-2 cursor-pointer">
              <input
                type="radio"
                checked={sendMode === 'all'}
                onChange={() => setSendMode('all')}
                className="accent-jade"
              />
              <span className="text-sm">
                Resend to all {recipients.length} (calendar entries will update)
              </span>
            </label>
          </div>
        )}

        <div className="mb-5">
          <label className="label">Optional message <span className="text-ink/30 normal-case tracking-normal italic font-normal">— shown in the email body</span></label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder="Bring an extra deck. Parking is free on the street."
            rows={3}
          />
        </div>

        {result && (
          <div className={`p-3 text-sm mb-4 border ${result.ok ? 'border-jade/40 bg-jade/5 text-ink' : 'border-cinnabar/40 bg-cinnabar/5 text-cinnabar'}`}>
            {result.message}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={handleSend}
            className="btn btn-jade flex-1 justify-center"
            disabled={sending || recipientsForThisSend.length === 0}
          >
            {sending
              ? 'Sending…'
              : recipientsForThisSend.length === 0
                ? 'Nothing to send'
                : `Send to ${recipientsForThisSend.length}`}
          </button>
          <a
            href={downloadUrl}
            className="btn btn-ghost"
            download
          >
            Download .ics
          </a>
          <button onClick={onClose} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar ml-auto">
            Close
          </button>
        </div>

        <p className="text-xs text-ink/40 italic mt-4 leading-snug">
          Recipients will get an email with a calendar invite attached. Replies route directly to the host. Resending updates each recipient's calendar entry rather than creating duplicates.
        </p>
      </div>
    </div>
  );
}
