const KEY = 'taskdag-goal'
const BACKUP_KEY = 'taskdag-backup'

export function save(goal, appState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(goal))
    appState.storageBroken = false
  } catch (error) {
    appState.storageBroken = true
  }
}

export function load() {
  try {
    const text = localStorage.getItem(KEY)
    return text ? JSON.parse(text) : null
  } catch (error) {
    return null
  }
}

export function backupBeforeImport(appState) {
  try {
    const current = localStorage.getItem(KEY)
    if (current) {
      localStorage.setItem(BACKUP_KEY, current)
      appState.importBackupAvailable = true
    }
  } catch (error) {
    // backup is best-effort; import proceeds regardless
  }
}

export function undoImport() {
  try {
    const backup = localStorage.getItem(BACKUP_KEY)
    if (!backup) return null
    localStorage.removeItem(BACKUP_KEY)
    return JSON.parse(backup)
  } catch (error) {
    return null
  }
}
