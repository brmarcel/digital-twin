-- Plant Twin – Push-Speicherung und atomare Wasserstandsüberwachung
-- Einmalig im Supabase SQL Editor ausführen.
-- Nur die serverseitige Rolle service_role darf diese Daten lesen/schreiben.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  device_id text not null default 'plantpot/01',
  p256dh text not null,
  auth text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_device_id_idx
  on public.push_subscriptions(device_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create table if not exists public.plant_alert_state (
  device_id text primary key,
  candidate text not null default '',
  consecutive smallint not null default 0,
  critical_notified boolean not null default false,
  empty_notified boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.plant_alert_state enable row level security;
revoke all on public.plant_alert_state from anon, authenticated;
grant select, insert, update, delete on public.plant_alert_state to service_role;

-- Ein MQTT-Messwert pro Aufruf. >=2 zusammenhängende Messwerte pro Zone.
-- Grenzwerte wie im Dashboard: kritisch <15 %, leer <=5 %, Reset >=20 %.
create or replace function public.evaluate_water_alert(
  p_device_id text,
  p_volume_ml numeric
)
returns table(alert_kind text, water_percent numeric)
language plpgsql
set search_path = public
as $$
declare
  v_percent numeric;
  v_zone text;
  v_state public.plant_alert_state%rowtype;
  v_alert text := null;
begin
  if p_device_id is distinct from 'plantpot/01' or
     p_volume_ml is null or p_volume_ml < 0 or p_volume_ml > 1800 then
    raise exception 'Ungueltige Wasserstandsmessung';
  end if;

  v_percent := p_volume_ml / 1800 * 100;
  v_zone := case
    when v_percent <= 5 then 'empty'
    when v_percent < 15 then 'critical'
    when v_percent >= 20 then 'reset'
    else 'intermediate'
  end;

  -- Schützt den Alarmzustand gegen parallele Vercel-Aufrufe.
  perform pg_advisory_xact_lock(hashtext(p_device_id));
  insert into public.plant_alert_state(device_id) values(p_device_id)
  on conflict (device_id) do nothing;
  select * into v_state from public.plant_alert_state where device_id = p_device_id for update;
  if v_zone = v_state.candidate then
    v_state.consecutive := least(v_state.consecutive + 1, 2);
  else
    v_state.candidate := v_zone;
    v_state.consecutive := 1;
  end if;

  if v_state.consecutive >= 2 then
    if v_zone = 'reset' then
      v_state.critical_notified := false;
      v_state.empty_notified := false;
    elsif v_zone = 'empty' and not v_state.empty_notified then
      v_alert := 'empty';
      v_state.empty_notified := true;
      v_state.critical_notified := true; -- Direkt leer: keine redundante kritische Meldung.
    elsif v_zone = 'critical' and not v_state.critical_notified then
      v_alert := 'critical';
      v_state.critical_notified := true;
    end if;
  end if;

  update public.plant_alert_state set
    candidate = v_state.candidate,
    consecutive = v_state.consecutive,
    critical_notified = v_state.critical_notified,
    empty_notified = v_state.empty_notified,
    updated_at = now()
  where device_id = p_device_id;

  return query select v_alert, v_percent;
end;
$$;
revoke all on function public.evaluate_water_alert(text, numeric) from public, anon, authenticated;
grant execute on function public.evaluate_water_alert(text, numeric) to service_role;
