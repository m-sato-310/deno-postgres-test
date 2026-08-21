-- Up Migration

create table memos (
  id         serial primary key,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memos_created_at_idx on memos (created_at desc);

-- Down Migration

drop table memos;
