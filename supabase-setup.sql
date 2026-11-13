create table public.barber_admins (
    user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.appointments (
    id uuid primary key default gen_random_uuid(),
    customer_name text not null check (char_length(trim(customer_name)) between 2 and 100),
    customer_phone text not null check (char_length(regexp_replace(customer_phone, '[^0-9]', '', 'g')) between 8 and 15),
    service text not null check (service in ('Corte masculino', 'Barba', 'Corte + barba')),
    appointment_date date not null,
    appointment_time time without time zone not null,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
    created_at timestamptz not null default now()
);

create unique index appointments_one_active_per_slot
    on public.appointments (appointment_date, appointment_time)
    where status in ('pending', 'confirmed');

alter table public.barber_admins enable row level security;
alter table public.appointments enable row level security;

create or replace function public.is_barber_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.barber_admins
        where user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_barber_admin() from public, anon;
grant execute on function public.is_barber_admin() to authenticated;

create policy "Only the barber can read appointments"
    on public.appointments for select
    to authenticated
    using ((select public.is_barber_admin()));

create policy "Only the barber can update appointments"
    on public.appointments for update
    to authenticated
    using ((select public.is_barber_admin()))
    with check ((select public.is_barber_admin()));

revoke all on public.appointments from anon, authenticated;
grant select on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;
revoke all on public.barber_admins from anon, authenticated;

create or replace function public.get_unavailable_slots(p_date date)
returns table (appointment_time text)
language sql
stable
security definer
set search_path = ''
as $$
    select to_char(a.appointment_time, 'HH24:MI')
    from public.appointments as a
    where a.appointment_date = p_date
      and a.status in ('pending', 'confirmed')
    order by a.appointment_time;
$$;

revoke all on function public.get_unavailable_slots(date) from public;
grant execute on function public.get_unavailable_slots(date) to anon, authenticated;

create or replace function public.create_appointment(
    p_customer_name text,
    p_customer_phone text,
    p_service text,
    p_date date,
    p_time text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    appointment_id uuid;
    local_now timestamp without time zone := now() at time zone 'America/Sao_Paulo';
    requested_time time without time zone;
begin
    if p_customer_name is null or char_length(trim(p_customer_name)) not between 2 and 100 then
        raise exception 'INVALID_CUSTOMER_NAME';
    end if;

    if p_customer_phone is null
       or char_length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) not between 8 and 15 then
        raise exception 'INVALID_CUSTOMER_PHONE';
    end if;

    if p_service not in ('Corte masculino', 'Barba', 'Corte + barba') then
        raise exception 'INVALID_SERVICE';
    end if;

    if p_date is null or p_date < local_now::date or extract(isodow from p_date) = 7 then
        raise exception 'INVALID_DATE';
    end if;

    if p_time is null or p_time !~ '^(09|1[0-8]):(00|30)$' then
        raise exception 'INVALID_TIME';
    end if;

    requested_time := p_time::time;
    if (extract(isodow from p_date) = 6 and requested_time > time '16:30')
       or (extract(isodow from p_date) between 1 and 5 and requested_time > time '18:30') then
        raise exception 'INVALID_TIME';
    end if;

    if p_date = local_now::date and requested_time <= local_now::time then
        raise exception 'SLOT_UNAVAILABLE';
    end if;

    insert into public.appointments (
        customer_name,
        customer_phone,
        service,
        appointment_date,
        appointment_time
    )
    values (
        trim(p_customer_name),
        trim(p_customer_phone),
        p_service,
        p_date,
        requested_time
    )
    returning id into appointment_id;

    return appointment_id;
exception
    when unique_violation then
        raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_appointment(text, text, text, date, text) from public;
grant execute on function public.create_appointment(text, text, text, date, text) to anon, authenticated;
