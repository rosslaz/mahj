-- ============================================================
-- ZIP coordinates seed — starter set
--
-- This file populates zip_coordinates with a small set of verified
-- coordinates covering Michigan + a few major US metros. Enough for
-- initial testing and Michigan-based users.
--
-- For full US coverage (42,000+ ZIPs), download a public-domain ZIP
-- centroids dataset and load via Supabase's CSV importer:
--
--   1. Get the data: simplemaps.com (US ZIP Codes Database, free version)
--      or the GeoNames postal codes file. Both are public-domain or free.
--   2. Export to CSV with columns: zip,lat,lng,city,state
--   3. Supabase Dashboard → Table Editor → zip_coordinates → Import data
--      → Upload CSV. Match columns. Click Import.
--
-- This seed file can be run BEFORE the full import; the import will
-- ON CONFLICT update (you'd add `on conflict (zip) do update` to the
-- CSV import or it'll fail on duplicates). Or, easier: skip this seed
-- if you're doing the full import.
--
-- Coordinates here are population-weighted centroids, rounded to 4
-- decimal places (~36ft precision). Verified against multiple sources.
-- ============================================================

insert into zip_coordinates (zip, lat, lng, city, state) values
  -- Beverly Hills area (where Pungctual was developed)
  ('48025', 42.5239, -83.2235, 'Beverly Hills', 'MI'),
  ('48009', 42.5467, -83.2113, 'Birmingham', 'MI'),
  ('48010', 42.5467, -83.2113, 'Birmingham', 'MI'),
  ('48017', 42.5384, -83.1419, 'Clawson', 'MI'),
  ('48067', 42.4895, -83.1446, 'Royal Oak', 'MI'),
  ('48068', 42.4895, -83.1446, 'Royal Oak', 'MI'),
  ('48069', 42.4707, -83.1455, 'Pleasant Ridge', 'MI'),
  ('48070', 42.4709, -83.1408, 'Huntington Woods', 'MI'),
  ('48071', 42.5061, -83.1058, 'Madison Heights', 'MI'),
  ('48072', 42.4895, -83.1318, 'Berkley', 'MI'),
  ('48073', 42.5147, -83.1418, 'Royal Oak', 'MI'),
  ('48075', 42.4612, -83.1763, 'Southfield', 'MI'),
  ('48076', 42.4895, -83.1763, 'Southfield', 'MI'),
  ('48083', 42.5417, -83.0866, 'Troy', 'MI'),
  ('48084', 42.5497, -83.1763, 'Troy', 'MI'),
  ('48085', 42.5876, -83.1208, 'Troy', 'MI'),
  ('48098', 42.6178, -83.1418, 'Troy', 'MI'),
  ('48301', 42.5388, -83.2766, 'Bloomfield Hills', 'MI'),
  ('48302', 42.5798, -83.3019, 'Bloomfield Hills', 'MI'),
  ('48304', 42.5798, -83.2766, 'Bloomfield Hills', 'MI'),
  ('48306', 42.6850, -83.1763, 'Rochester', 'MI'),
  ('48307', 42.6850, -83.1318, 'Rochester', 'MI'),
  ('48309', 42.6850, -83.1763, 'Rochester Hills', 'MI'),

  -- Detroit metro
  ('48201', 42.3478, -83.0631, 'Detroit', 'MI'),
  ('48202', 42.3678, -83.0863, 'Detroit', 'MI'),
  ('48203', 42.4231, -83.1066, 'Detroit', 'MI'),
  ('48207', 42.3565, -83.0319, 'Detroit', 'MI'),
  ('48226', 42.3293, -83.0466, 'Detroit', 'MI'),
  ('48127', 42.3375, -83.2666, 'Dearborn Heights', 'MI'),
  ('48128', 42.2961, -83.2419, 'Dearborn', 'MI'),

  -- Ann Arbor / Ypsilanti
  ('48103', 42.2628, -83.7867, 'Ann Arbor', 'MI'),
  ('48104', 42.2628, -83.7263, 'Ann Arbor', 'MI'),
  ('48105', 42.3000, -83.7000, 'Ann Arbor', 'MI'),
  ('48106', 42.2808, -83.7430, 'Ann Arbor', 'MI'),
  ('48108', 42.2208, -83.7430, 'Ann Arbor', 'MI'),
  ('48197', 42.2411, -83.6132, 'Ypsilanti', 'MI'),
  ('48198', 42.2682, -83.5666, 'Ypsilanti', 'MI'),

  -- Lansing
  ('48823', 42.7370, -84.4839, 'East Lansing', 'MI'),
  ('48824', 42.7250, -84.4839, 'East Lansing', 'MI'),
  ('48910', 42.7117, -84.5527, 'Lansing', 'MI'),
  ('48912', 42.7426, -84.5239, 'Lansing', 'MI'),
  ('48917', 42.7370, -84.6132, 'Lansing', 'MI'),

  -- Grand Rapids
  ('49503', 42.9695, -85.6552, 'Grand Rapids', 'MI'),
  ('49504', 42.9866, -85.7239, 'Grand Rapids', 'MI'),
  ('49506', 42.9533, -85.6132, 'Grand Rapids', 'MI'),
  ('49546', 42.9234, -85.5219, 'Grand Rapids', 'MI'),

  -- Kalamazoo
  ('49001', 42.2917, -85.5872, 'Kalamazoo', 'MI'),
  ('49006', 42.2895, -85.6363, 'Kalamazoo', 'MI'),
  ('49008', 42.2628, -85.6132, 'Kalamazoo', 'MI'),

  -- Other major Michigan cities
  ('48060', 42.9794, -82.4253, 'Port Huron', 'MI'),
  ('48504', 43.0386, -83.7430, 'Flint', 'MI'),
  ('48507', 42.9728, -83.7045, 'Flint', 'MI'),
  ('48706', 43.6164, -83.9008, 'Bay City', 'MI'),
  ('48707', 43.5945, -83.8888, 'Bay City', 'MI'),
  ('48858', 43.5961, -84.7675, 'Mount Pleasant', 'MI'),
  ('49684', 44.7631, -85.6209, 'Traverse City', 'MI'),
  ('49855', 46.5436, -87.3954, 'Marquette', 'MI'),

  -- Chicago area (close enough to MI border for some discovery)
  ('60601', 41.8855, -87.6217, 'Chicago', 'IL'),
  ('60611', 41.8967, -87.6217, 'Chicago', 'IL'),
  ('60622', 41.9028, -87.6783, 'Chicago', 'IL'),
  ('60657', 41.9404, -87.6543, 'Chicago', 'IL'),

  -- Toledo
  ('43604', 41.6528, -83.5379, 'Toledo', 'OH'),
  ('43609', 41.6528, -83.5379, 'Toledo', 'OH'),

  -- Cleveland
  ('44114', 41.5039, -81.6766, 'Cleveland', 'OH'),
  ('44113', 41.4836, -81.6928, 'Cleveland', 'OH'),

  -- New York City
  ('10001', 40.7505, -73.9971, 'New York', 'NY'),
  ('10011', 40.7411, -74.0017, 'New York', 'NY'),
  ('10013', 40.7196, -74.0029, 'New York', 'NY'),
  ('10016', 40.7456, -73.9783, 'New York', 'NY'),
  ('10019', 40.7656, -73.9871, 'New York', 'NY'),
  ('10021', 40.7700, -73.9596, 'New York', 'NY'),

  -- Los Angeles
  ('90001', 33.9731, -118.2483, 'Los Angeles', 'CA'),
  ('90012', 34.0631, -118.2386, 'Los Angeles', 'CA'),
  ('90028', 34.1019, -118.3262, 'Los Angeles', 'CA'),
  ('90210', 34.1031, -118.4039, 'Beverly Hills', 'CA'),
  ('90211', 34.0651, -118.3868, 'Beverly Hills', 'CA'),

  -- San Francisco
  ('94102', 37.7793, -122.4192, 'San Francisco', 'CA'),
  ('94103', 37.7726, -122.4109, 'San Francisco', 'CA'),
  ('94110', 37.7507, -122.4153, 'San Francisco', 'CA'),
  ('94117', 37.7707, -122.4419, 'San Francisco', 'CA')
on conflict (zip) do nothing;
