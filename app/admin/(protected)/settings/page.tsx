import { redirect } from "next/navigation";

// /admin/settings is not a page of its own — the rail in the layout is the
// index, and landing on an empty shell would read as a broken screen. Access
// is first because it is the one most often changed.
export default function SettingsIndex() {
  redirect("/admin/settings/access");
}
