import { NotFoundContent } from "@/components/app/not-found-content";

// Unknown routes outside the shell (sign-in, portal) render here, without the sidebar.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <NotFoundContent />
    </main>
  );
}
