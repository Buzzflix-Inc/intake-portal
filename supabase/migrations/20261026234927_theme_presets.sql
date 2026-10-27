-- Theme presets (see src/js/ui/themes.js) and dark mode, per company.
-- primary_color / accent_color stay as the preset's light colours, for anything that reads them.
alter table public.companies
  add column theme text,
  add column dark_mode boolean not null default false;

update public.companies set theme = case
  when primary_color = '#1a1a1a' and accent_color = '#b4550b' then 'classic'
  when primary_color = '#111827' and accent_color = '#4f46e5' then 'midnight'
  when primary_color = '#14321f' and accent_color = '#2f7d4a' then 'forest'
  when primary_color = '#0b2a3c' and accent_color = '#0e7490' then 'ocean'
  when primary_color = '#2a0f12' and accent_color = '#b42332' then 'crimson'
  when primary_color = '#2b1630' and accent_color = '#8b3fa8' then 'plum'
end;
alter table public.companies alter column theme set default 'classic';
