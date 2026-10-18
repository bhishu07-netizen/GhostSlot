-- Pin search_path on every twin function (Supabase advisor 0011), so a
-- role with a different search_path can't make them resolve other objects.
alter function public.gs_rand(text)                              set search_path = '';
alter function public.gs_twin_generate(timestamptz, timestamptz) set search_path = '';
alter function public.gs_twin_heatmap(int)                       set search_path = '';
alter function public.gs_twin_energy(int)                        set search_path = '';
alter function public.gs_twin_energy_daily(int)                  set search_path = '';
alter function public.gs_twin_water_anomalies(int, numeric)      set search_path = '';
alter function public.gs_twin_now()                              set search_path = '';
