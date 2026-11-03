import styles from "./IosNotificationSteps.module.css";

export function IosNotificationSteps({ admin = false }: { admin?: boolean }) {
  return <div className={styles.guide}>
    <h3>Turn on notifications on iPhone or iPad</h3>
    <p>First, add DB Cinema to your Home Screen. You only need to do this once on this device.</p>
    <ol>
      <li><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></span><span>Open this page in <strong>Safari</strong>. Tap <strong>Share</strong> (the square with an arrow). If you see <strong>•••</strong> instead, tap it, then tap <strong>Share</strong>.</span></li>
      <li><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg></span><span>Scroll down and tap <strong>Add to Home Screen</strong>. If it is missing, tap <strong>Edit Actions</strong> at the bottom and add it.</span></li>
      <li><span className={styles.number} aria-hidden="true">3</span><span>If shown, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</span></li>
      <li><span className={styles.number} aria-hidden="true">4</span><span>Open the new <strong>DB Cinema</strong> icon on your Home Screen. {admin ? <>Open the admin page and tap <strong>Phone alerts</strong>.</> : <>Sign in if asked, open your messages, and tap the <strong>bell</strong> then <strong>Enable notifications</strong>.</>} Tap <strong>Allow</strong> when your device asks.</span></li>
    </ol>
  </div>;
}
