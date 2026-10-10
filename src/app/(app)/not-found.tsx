import { NotFoundContent } from "@/components/app/not-found-content";

// Unknown routes inside the shell render here, so the sidebar and topbar stay available (frontend-patterns §2).
export default function AppNotFound() {
  return <NotFoundContent />;
}
