import { SettingsForm } from "@/components/AdminForms";
import { Card, PageHeader } from "@/components/ui";
import { getAllSettingRows } from "@/lib/settings/server";
import { updateSettingsAction } from "../actions";

export const metadata = { title: "Pengaturan — Admin" };

export default async function SettingsPage() {
  const m = new Map((await getAllSettingRows()).map((r) => [r.key, r.value]));
  const str = (k: string) => (typeof m.get(k) === "string" ? (m.get(k) as string) : "");
  const num = (k: string) => (typeof m.get(k) === "number" ? (m.get(k) as number) : 0);

  return (
    <>
      <PageHeader title="Pengaturan" description="Berlaku langsung. Setiap perubahan tercatat di audit." />
      <Card className="max-w-3xl">
        <SettingsForm action={updateSettingsAction} s={{
          maintenance_mode: m.get("maintenance_mode") === true,
          catalog_activate_new: m.get("catalog_activate_new") === true,
          catalog_default_margin: num("catalog_default_margin"),
          support_contact: str("support_contact"),
          announcement: str("announcement"),
          topup_enabled: m.get("topup_enabled") === true,
          topup_min_amount: num("topup_min_amount"),
          topup_max_amount: num("topup_max_amount"),
          topup_code_min: num("topup_code_min"),
          topup_code_max: num("topup_code_max"),
          topup_expiry_minutes: num("topup_expiry_minutes"),
        }} />
      </Card>
    </>
  );
}
