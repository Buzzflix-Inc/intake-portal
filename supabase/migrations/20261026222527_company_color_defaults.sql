-- New companies start with the portal's default theme colours (the app expects both to be set).
alter table public.companies alter column primary_color set default '#1a1a1a';
alter table public.companies alter column accent_color set default '#b4550b';
update public.companies set primary_color = coalesce(primary_color, '#1a1a1a'), accent_color = coalesce(accent_color, '#b4550b')
where primary_color is null or accent_color is null;
