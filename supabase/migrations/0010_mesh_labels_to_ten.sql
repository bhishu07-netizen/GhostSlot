-- GhostSlot 0.7: people-count labels 0..10 for mesh recordings ('5+' kept for
-- older rows). Security is unchanged (RLS on, no grants for anon/authenticated).
alter table public.gs_mesh_rows drop constraint if exists gs_mesh_rows_label_check;
alter table public.gs_mesh_rows add constraint gs_mesh_rows_label_check
  check (label in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '5+',
                   'z-front', 'z-back', 'z-left', 'z-right', 'z-centre'));
