CREATE TABLE
  "eventsourcing"."subscription_checkpoint" (
    "id" VARCHAR(100) PRIMARY KEY,
    "position" BIGINT NOT NULL
  );
