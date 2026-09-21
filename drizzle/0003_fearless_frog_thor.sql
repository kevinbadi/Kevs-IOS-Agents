CREATE TABLE "scheduler"."decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid,
	"device_udid" text NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"model" text NOT NULL,
	"questions" jsonb NOT NULL,
	"chosen" text,
	"probabilities" jsonb NOT NULL,
	"confidence" real,
	"fits" real,
	"escalated" boolean NOT NULL,
	"escalation_reason" text,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler"."decisions" ADD CONSTRAINT "decisions_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "scheduler"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_created_idx" ON "scheduler"."decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "decisions_escalated_idx" ON "scheduler"."decisions" USING btree ("escalated","created_at");--> statement-breakpoint
CREATE INDEX "decisions_execution_idx" ON "scheduler"."decisions" USING btree ("execution_id");