import net from 'net'
import { spawn } from 'child_process'

// Trouve le premier port libre a partir de la valeur demandee (defaut 3000).
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(start + 1))
      } else {
        reject(err)
      }
    })
    probe.once('listening', () => {
      probe.close(() => resolve(start))
    })
    probe.listen(start, '127.0.0.1')
  })
}

const preferred = Number(process.env.PORT || 3000)
const port = await findFreePort(preferred)

console.log(`[dev] Port ${preferred} ${port === preferred ? 'libre' : `occupe -> utilisation du port ${port}`}`)
console.log(`[dev] App accessible sur http://localhost:${port}`)

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)],
  { stdio: 'inherit' },
)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig))
}

child.on('exit', (code) => process.exit(code ?? 0))
