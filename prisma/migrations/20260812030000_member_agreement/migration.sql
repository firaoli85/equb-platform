-- THE MEMBER AGREEMENT — per member, signed before the portal.
--
-- Three parts, and the shape of each follows a ruling.
--
-- 1. `participations.agreementRequiredAt`. SENDING THE WELCOME IS WHAT
--    REQUIRES A SIGNATURE. Null means no welcome has been sent, so the member
--    is not gated — which is how the 27 people already mid-cycle stay
--    untouched with no date comparison and no exemption list. It is a
--    TIMESTAMP rather than a flag so the gate can ask "is there a signature
--    NEWER than this?": sending again after changing someone's terms sets a
--    later moment and requires a fresh signature against the current terms,
--    with no re-sign flow to build.
--
-- 2. `agreement_versions`. The wording is organizer-editable (2.6, 2.23), and
--    an edit APPENDS a version rather than rewriting one. A signature is bound
--    by hash to the text it was shown, so a row that could change in place
--    would leave past signatures pointing at wording that no longer exists.
--
-- 3. `agreement_signatures`. The evidence. There is deliberately NO mac
--    address column: a web page cannot read one on any browser, and a column
--    that can never be filled honestly is a claim the record cannot support.

ALTER TABLE "participations" ADD COLUMN "agreementRequiredAt" TIMESTAMP(3);

CREATE TABLE "agreement_versions" (
  "id"        TEXT NOT NULL,
  "version"   INTEGER NOT NULL,
  "body"      TEXT NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreement_versions_version_key" ON "agreement_versions"("version");

CREATE TABLE "agreement_signatures" (
  "id"                 TEXT NOT NULL,
  "participationId"    TEXT NOT NULL,
  "personId"           TEXT NOT NULL,
  "agreementVersionId" TEXT NOT NULL,
  "documentHash"       TEXT NOT NULL,
  "documentText"       TEXT NOT NULL,
  "signedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip"                 TEXT NOT NULL,
  "userAgent"          TEXT NOT NULL,
  "browser"            TEXT NOT NULL,
  "os"                 TEXT NOT NULL,
  "deviceType"         TEXT NOT NULL,
  "screen"             TEXT,
  "timezone"           TEXT,
  "location"           TEXT,
  CONSTRAINT "agreement_signatures_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agreement_signatures_participation_signed_idx"
  ON "agreement_signatures"("participationId", "signedAt");
CREATE INDEX "agreement_signatures_person_idx" ON "agreement_signatures"("personId");

ALTER TABLE "agreement_signatures"
  ADD CONSTRAINT "agreement_signatures_participationId_fkey"
  FOREIGN KEY ("participationId") REFERENCES "participations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agreement_signatures"
  ADD CONSTRAINT "agreement_signatures_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "people"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, not CASCADE: deleting a version would destroy the proof of what
-- somebody signed. Versions are append-only and this makes the database say so.
ALTER TABLE "agreement_signatures"
  ADD CONSTRAINT "agreement_signatures_agreementVersionId_fkey"
  FOREIGN KEY ("agreementVersionId") REFERENCES "agreement_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A SIGNATURE IS A RECORD, NOT A ROW TO TIDY. The audit log already has this
-- trigger for the same reason (20260807030000_audit_log_append_only): evidence
-- that can be edited after the fact is not evidence.
CREATE OR REPLACE FUNCTION agreement_signatures_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'agreement_signatures is append-only: a signature cannot be % after the fact', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_signatures_no_update
  BEFORE UPDATE OR DELETE ON "agreement_signatures"
  FOR EACH ROW EXECUTE FUNCTION agreement_signatures_append_only();
