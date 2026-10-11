import { lazy, Suspense, type ReactNode } from 'react'
import { useUi } from '../store/uiStore'
import { Dialog } from './ui'

// Each dialog (and what it needs, e.g. the KML/ZIP libraries) loads the first time it opens
const MapsDialog = lazy(() => import('./dialogs/MapsDialog'))
const ImportDialog = lazy(() => import('./dialogs/ImportDialog'))
const ExportDialog = lazy(() => import('./dialogs/ExportDialog'))
const ShareDialog = lazy(() => import('./dialogs/ShareDialog'))
const SettingsDialog = lazy(() => import('./dialogs/SettingsDialog'))
const ConflictDialog = lazy(() => import('./dialogs/ConflictDialog'))
const AboutDialog = lazy(() => import('./dialogs/AboutDialog'))

const Loading = ({ children }: { children: ReactNode }) => <Suspense fallback={<p className="hint">טוען…</p>}>{children}</Suspense>

export function Dialogs() {
  const dialog = useUi((s) => s.dialog)
  const close = () => useUi.getState().openDialog(null)
  return (
    <>
      <Dialog open={dialog === 'maps'} onClose={close} title="המפות שלי" wide>
        <Loading>
          <MapsDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'import'} onClose={close} title="ייבוא">
        <Loading>
          <ImportDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'export'} onClose={close} title="ייצוא">
        <Loading>
          <ExportDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'share'} onClose={close} title="שיתוף">
        <Loading>
          <ShareDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'settings'} onClose={close} title="הגדרות">
        <Loading>
          <SettingsDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'conflict'} onClose={close} title="המפה שונתה במקום אחר">
        <Loading>
          <ConflictDialog />
        </Loading>
      </Dialog>
      <Dialog open={dialog === 'about'} onClose={close} title="אודות MyMaps AI">
        <Loading>
          <AboutDialog />
        </Loading>
      </Dialog>
    </>
  )
}
