import { getAgreementVersions } from "@/app/actions/agreement";
import { Alert } from "@/components/ui/primitives";
import { AgreementVersionsScreen } from "./agreement-versions";

export const dynamic = "force-dynamic";

// THE MEMBER AGREEMENT'S WORDING — versioned, create-only (Cycle-2 build,
// feature C). The two actions this screen wires (getAgreementVersions,
// publishAgreementVersion) existed tested and imported by nothing; until now
// changing the wording meant a deploy, while the organizer ruling said it is
// editable.
export default async function AgreementSettingsPage() {
  const result = await getAgreementVersions();
  if (!result.ok) {
    return <Alert kind="err">{result.error}</Alert>;
  }
  return (
    <AgreementVersionsScreen
      currentVersion={result.data.currentVersion}
      currentBody={result.data.currentBody}
      versions={result.data.versions}
    />
  );
}
