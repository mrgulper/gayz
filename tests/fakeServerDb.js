// An in-memory stand-in for Firebase Realtime Database with just the two
// calls api/_lib/servers.js uses (get a path, multi-path update), so the
// tests run the servers' real rules without Firebase.
export function fakeServerDb() {
  const root = {}
  const parts = (path) => path.split('/').filter(Boolean)
  function get(path) {
    let node = root
    for (const k of parts(path)) {
      if (node == null || typeof node !== 'object') return null
      node = node[k]
    }
    return node === undefined ? null : JSON.parse(JSON.stringify(node))
  }
  function set(path, value) {
    const ks = parts(path)
    let node = root
    for (const k of ks.slice(0, -1)) {
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {}
      node = node[k]
    }
    const last = ks[ks.length - 1]
    if (value === null) delete node[last]
    else node[last] = JSON.parse(JSON.stringify(value))
  }
  return {
    root,
    async get(path) {
      return get(path)
    },
    async update(paths) {
      // Firebase refuses an update where one path sits inside another.
      const keys = Object.keys(paths)
      for (const a of keys) {
        for (const b of keys) {
          if (a !== b && b.startsWith(`${a}/`)) throw new Error(`overlapping update paths: ${a} and ${b}`)
        }
      }
      for (const [path, value] of Object.entries(paths)) set(path, value)
    },
  }
}
