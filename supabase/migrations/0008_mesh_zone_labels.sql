-- GhostSlot 0.5.2: zone-mode labels for mesh recordings.
-- Besides people counts ('0'..'5+'), a recording can now be "one person in
-- zone X" ('z-front', 'z-back', 'z-left', 'z-right', 'z-centre').
-- Security is unchanged (RLS on, no grants for anon/authenticated).

alter table public.gs_mesh_rows drop constraint if exists gs_mesh_rows_label_check;
alter table public.gs_mesh_rows add constraint gs_mesh_rows_label_check
  check (label in ('0', '1', '2', '3', '4', '5+',
                   'z-front', 'z-back', 'z-left', 'z-right', 'z-centre'));
