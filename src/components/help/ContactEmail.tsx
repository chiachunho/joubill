import { contactEmail } from "@/lib/contact";

/** The contact address from `CONTACT_EMAIL`, for the legal pages' MDX. */
export function ContactEmail() {
  const email = contactEmail();
  if (!email) return <span>（尚未設定聯絡信箱）</span>;
  return (
    <a
      href={`mailto:${email}`}
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {email}
    </a>
  );
}
