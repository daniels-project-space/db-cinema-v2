import { BasketReminderUnsubscribe } from "@/components/cart/BasketReminderUnsubscribe";

export default async function BasketReminderPreferences({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="section-window flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-charcoal-900/80 p-8 text-center shadow-2xl">
        <div className="hud-label !text-accent-400/90">Email preferences</div>
        <h1 className="mt-3 font-display text-3xl font-bold text-white">Basket reminders</h1>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          Turn off automatic rental basket reminder emails for the account that received this message. This does not change booking, payment, or verification emails.
        </p>
        <BasketReminderUnsubscribe token={token} />
      </section>
    </main>
  );
}
