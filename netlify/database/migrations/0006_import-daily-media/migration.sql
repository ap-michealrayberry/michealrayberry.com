create table if not exists public_record.daily_media (
  project_date date primary key references public_record.project_days(project_date),
  photo_front_url text,
  photo_left_url text,
  photo_rear_url text,
  photo_right_url text,
  inspection_video_url text,
  source_system text not null,
  source_record_id text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public_record.daily_media
  (project_date, photo_front_url, photo_left_url, photo_rear_url, photo_right_url, inspection_video_url, source_system, source_record_id)
values
('2026-07-20','https://michealrayberry.com/photos/micheal-ray-berry-day-001-front-2026-07-20.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-001-left-2026-07-20.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-001-rear-2026-07-20.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-001-right-2026-07-20.jpg','https://drive.google.com/file/d/1gUnOwliQn8Pwncw9XbSQ67WUXf00k6eR/view','google-sheets','Weigh-ins!2'),
('2026-07-21','https://michealrayberry.com/photos/micheal-ray-berry-day-002-front-2026-07-21.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-002-left-2026-07-21.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-002-rear-2026-07-21.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-002-right-2026-07-21.jpg','https://drive.google.com/file/d/104yR70kd0A8CxLk09A7MW8WeLDsxvH1s/view','google-sheets','Weigh-ins!3'),
('2026-07-22','https://michealrayberry.com/photos/micheal-ray-berry-day-003-front-2026-07-22.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-003-left-2026-07-22.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-003-rear-2026-07-22.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-003-right-2026-07-22.jpg','https://drive.google.com/file/d/1lQIfrUKI41KlqgSUWbYUIBa2HmdEi1Uc/view','google-sheets','Weigh-ins!4'),
('2026-07-23','https://michealrayberry.com/photos/micheal-ray-berry-day-004-front-2026-07-23.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-004-left-2026-07-23.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-004-rear-2026-07-23.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-004-right-2026-07-23.jpg','https://drive.google.com/file/d/1hPXx-WvgQNVwPqaKjgDRchkJlCeKZ313/view','google-sheets','Weigh-ins!5'),
('2026-07-24','https://michealrayberry.com/photos/micheal-ray-berry-day-005-front-2026-07-24.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-005-left-2026-07-24.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-005-rear-2026-07-24.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-005-right-2026-07-24.jpg','https://drive.google.com/file/d/1-ZBhb2GveBHriJIkDnzt66g-12kKRDDj/view','google-sheets','Weigh-ins!6'),
('2026-07-25','https://michealrayberry.com/photos/micheal-ray-berry-day-006-front-2026-07-25.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-006-left-2026-07-25.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-006-rear-2026-07-25.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-006-right-2026-07-25.jpg','https://drive.google.com/file/d/1n1CUSGg4CcX6aQzs37_llCSpmplwQzFU/view','google-sheets','Weigh-ins!7'),
('2026-07-26','https://michealrayberry.com/photos/micheal-ray-berry-day-007-front-2026-07-26.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-007-left-2026-07-26.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-007-rear-2026-07-26.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-007-right-2026-07-26.jpg','https://drive.google.com/file/d/1gdhl9hl4ghl9oydH9g_hx9KkqfTZ2YD8/view','google-sheets','Weigh-ins!8'),
('2026-07-27','https://michealrayberry.com/photos/micheal-ray-berry-day-008-front-2026-07-27.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-008-left-2026-07-27.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-008-rear-2026-07-27.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-008-right-2026-07-27.jpg','https://drive.google.com/file/d/1Fmk9j5odd9YQnsljkggzFH7X2H4oIypx/view','google-sheets','Weigh-ins!9'),
('2026-07-28','https://michealrayberry.com/photos/micheal-ray-berry-day-009-front-2026-07-28.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-009-left-2026-07-28.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-009-rear-2026-07-28.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-009-right-2026-07-28.jpg','https://drive.google.com/file/d/1IaPOoHNbY7PJijtl4BrP8YIv1K6zflww/view','google-sheets','Weigh-ins!10'),
('2026-07-29','https://michealrayberry.com/photos/micheal-ray-berry-day-010-front-2026-07-29.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-010-left-2026-07-29.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-010-rear-2026-07-29.jpg','https://michealrayberry.com/photos/micheal-ray-berry-day-010-right-2026-07-29.jpg','https://drive.google.com/file/d/1MWeTklEYfAD3vT8whxJFqRwhPpbEtNaL/view','google-sheets','Weigh-ins!11'),
('2026-07-30','https://drive.google.com/thumbnail?id=1rmhQpWu70MIv7gnPBTcIyoZWh9m05gUA&sz=w1200','https://drive.google.com/thumbnail?id=1sf9isE5r7lqF6-u8iN93DHoEyi-OO-_j&sz=w1200','https://drive.google.com/thumbnail?id=1b57wzZdm8BOFyt5BdMqMSJ9pFF3wsSD7&sz=w1200','https://drive.google.com/thumbnail?id=1sB4wInklDIF-NYZjSpWIrH757_TiwTs3&sz=w1200','https://drive.google.com/file/d/1Pg2EvEgGEGfuKHi905T9QTA_QeNoarqh/view','google-sheets','Weigh-ins!12')
on conflict (project_date) do update set
  photo_front_url = excluded.photo_front_url,
  photo_left_url = excluded.photo_left_url,
  photo_rear_url = excluded.photo_rear_url,
  photo_right_url = excluded.photo_right_url,
  inspection_video_url = excluded.inspection_video_url,
  source_system = excluded.source_system,
  source_record_id = excluded.source_record_id,
  imported_at = now();

create or replace view public_record.daily_public_records as
select p.project_day,
       p.project_date,
       w.weight_lb,
       w.note,
       m.photo_front_url,
       m.photo_left_url,
       m.photo_rear_url,
       m.photo_right_url,
       m.inspection_video_url,
       (case when m.photo_front_url is not null then 1 else 0 end
        + case when m.photo_left_url is not null then 1 else 0 end
        + case when m.photo_rear_url is not null then 1 else 0 end
        + case when m.photo_right_url is not null then 1 else 0 end)::int as photo_count,
       case when m.inspection_video_url is not null then 1 else 0 end as video_count,
       (m.photo_front_url is not null and m.photo_left_url is not null and m.photo_rear_url is not null and m.photo_right_url is not null and m.inspection_video_url is not null) as media_complete
from public_record.project_days p
left join public_record.weight_records w using (project_date)
left join public_record.daily_media m using (project_date);
