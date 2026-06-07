/** Multi-layer animated gradient backdrop, fixed behind all content. */
export function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden>
      <div className="orb orb1" />
      <div className="orb orb2" />
      <div className="orb orb3" />
    </div>
  );
}
