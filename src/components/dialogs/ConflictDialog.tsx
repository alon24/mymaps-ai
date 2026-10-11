import { resolveConflict } from '../../lib/driveSync'

// ---------------- Conflict ----------------
export function ConflictDialog() {
  return (
    <div className="conflict">
      <p>מישהו (או מכשיר אחר) שמר את המפה ב-Drive אחרי השמירה האחרונה שלך. מה לעשות?</p>
      <div className="stack">
        <button type="button" className="btn btn--primary" onClick={() => void resolveConflict('copy')}>
          שמור את הגרסה שלי כמפה חדשה
        </button>
        <button type="button" className="btn" onClick={() => void resolveConflict('theirs')}>
          טען את הגרסה מ-Drive (השינויים שלי יאבדו)
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void resolveConflict('mine')}>
          דרוס עם הגרסה שלי
        </button>
      </div>
    </div>
  )
}

export default ConflictDialog
