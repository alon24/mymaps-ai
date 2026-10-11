import { useUi } from '../store/uiStore'
import { Dialog } from './ui'
import { MapsDialog } from './dialogs/MapsDialog'
import { ImportDialog } from './dialogs/ImportDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { ShareDialog } from './dialogs/ShareDialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { ConflictDialog } from './dialogs/ConflictDialog'
import { AboutDialog } from './dialogs/AboutDialog'

export function Dialogs() {
  const dialog = useUi((s) => s.dialog)
  const close = () => useUi.getState().openDialog(null)
  return (
    <>
      <Dialog open={dialog === 'maps'} onClose={close} title="המפות שלי" wide>
        <MapsDialog />
      </Dialog>
      <Dialog open={dialog === 'import'} onClose={close} title="ייבוא">
        <ImportDialog />
      </Dialog>
      <Dialog open={dialog === 'export'} onClose={close} title="ייצוא">
        <ExportDialog />
      </Dialog>
      <Dialog open={dialog === 'share'} onClose={close} title="שיתוף">
        <ShareDialog />
      </Dialog>
      <Dialog open={dialog === 'settings'} onClose={close} title="הגדרות">
        <SettingsDialog />
      </Dialog>
      <Dialog open={dialog === 'conflict'} onClose={close} title="המפה שונתה במקום אחר">
        <ConflictDialog />
      </Dialog>
      <Dialog open={dialog === 'about'} onClose={close} title="אודות MyMaps AI">
        <AboutDialog />
      </Dialog>
    </>
  )
}
