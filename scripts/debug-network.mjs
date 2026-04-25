import si from 'systeminformation'

console.log('--- defaultInterface ---')
console.log(await si.networkInterfaceDefault())

console.log('\n--- networkInterfaces (default only) ---')
const ifs = await si.networkInterfaces('default')
console.log(JSON.stringify(ifs, null, 2))

console.log('\n--- wifiConnections() ---')
try {
  const w = await si.wifiConnections()
  console.log(JSON.stringify(w, null, 2))
} catch (e) {
  console.log('wifiConnections error:', e.message)
}

console.log('\n--- networkStats x3 (1.5s apart) ---')
for (let i = 0; i < 3; i++) {
  const s = await si.networkStats()
  console.log(`call ${i}:`, JSON.stringify(s, null, 2))
  await new Promise((r) => setTimeout(r, 1500))
}

console.log('\n--- raw airport -I ---')
import('node:child_process').then(({ exec }) => {
  exec('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I', (err, stdout) => {
    if (err) console.log('airport error:', err.message)
    else console.log(stdout)
  })
})

console.log('\n--- raw networksetup -getairportnetwork ---')
import('node:child_process').then(({ exec }) => {
  exec('networksetup -getairportnetwork en0', (err, stdout) => {
    if (err) console.log('networksetup error:', err.message)
    else console.log(stdout)
  })
})
