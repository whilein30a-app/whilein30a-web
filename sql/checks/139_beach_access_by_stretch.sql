-- Update 139 (A57): which beach access points the water reports can use, per
-- stretch of 30A. Read only, changes nothing.
--
-- "Access points" = the public beach access listings the Map's Beach Access
-- chip shows (is_public_access, in the 30A area, with coordinates). Duplicate
-- imports at the same spot count once. Each point is given to the nearest
-- town centre, using the same 12 town centres the app uses
-- (constants/towns.ts).
--
-- Run PART 1, then PART 2, one at a time (the editor shows only the last
-- result). Send me both results.

-- PART 1: count per stretch. A row with points = 0 is a stretch with no
-- access point, which Kevin wants to know about.
with centres(stretch, lat, lng) as (values
  ('Grayton Beach', 30.328, -86.156),
  ('Seaside', 30.32, -86.226),
  ('Rosemary Beach', 30.335, -86.045),
  ('Alys Beach', 30.331, -86.058),
  ('Blue Mountain Beach', 30.335, -86.166),
  ('Dune Allen Beach', 30.353, -86.216),
  ('WaterColor', 30.323, -86.199),
  ('WaterSound', 30.336, -86.033),
  ('Seagrove Beach', 30.318, -86.118),
  ('Santa Rosa Beach', 30.354, -86.23),
  ('Seacrest Beach', 30.329, -86.069),
  ('Inlet Beach', 30.277, -86.0)
),
pts as (
  select distinct on (round(latitude::numeric, 4), round(longitude::numeric, 4))
    id, name, description, latitude::float8 as lat, longitude::float8 as lng
  from public.listings
  where is_public_access = true and coalesce(in_area, true) = true
    and latitude is not null and longitude is not null
  order by round(latitude::numeric, 4), round(longitude::numeric, 4), name
),
assigned as (
  select p.*, c.stretch, c.km
  from pts p
  cross join lateral (
    select stretch,
      111.32 * sqrt(power(p.lat - lat, 2) + power((p.lng - lng) * cos(radians(p.lat)), 2)) as km
    from centres
    order by 2
    limit 1
  ) c
)
select
  c.stretch,
  count(a.id) as points,
  count(a.id) filter (where a.description ilike 'Regional Beach Access%') as regional,
  round(max(a.km)::numeric, 1) as farthest_km_from_centre
from centres c
left join assigned a on a.stretch = c.stretch
group by c.stretch
order by points, c.stretch;

-- PART 2: every point with its stretch, to check on a map. A point far
-- (over about 3 km) from its stretch's centre is worth a look.
with centres(stretch, lat, lng) as (values
  ('Grayton Beach', 30.328, -86.156),
  ('Seaside', 30.32, -86.226),
  ('Rosemary Beach', 30.335, -86.045),
  ('Alys Beach', 30.331, -86.058),
  ('Blue Mountain Beach', 30.335, -86.166),
  ('Dune Allen Beach', 30.353, -86.216),
  ('WaterColor', 30.323, -86.199),
  ('WaterSound', 30.336, -86.033),
  ('Seagrove Beach', 30.318, -86.118),
  ('Santa Rosa Beach', 30.354, -86.23),
  ('Seacrest Beach', 30.329, -86.069),
  ('Inlet Beach', 30.277, -86.0)
),
pts as (
  select distinct on (round(latitude::numeric, 4), round(longitude::numeric, 4))
    id, name, description, latitude::float8 as lat, longitude::float8 as lng
  from public.listings
  where is_public_access = true and coalesce(in_area, true) = true
    and latitude is not null and longitude is not null
  order by round(latitude::numeric, 4), round(longitude::numeric, 4), name
)
select c.stretch, round(c.km::numeric, 1) as km_from_centre, p.name,
  round(p.lat::numeric, 5) as lat, round(p.lng::numeric, 5) as lng
from pts p
cross join lateral (
  select stretch,
    111.32 * sqrt(power(p.lat - lat, 2) + power((p.lng - lng) * cos(radians(p.lat)), 2)) as km
  from centres
  order by 2
  limit 1
) c
order by c.stretch, p.lng;
