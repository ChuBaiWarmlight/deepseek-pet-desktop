import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parse, compileTemplate } = require('./node_modules/.pnpm/@vue+compiler-sfc@3.5.41/node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js')

const src = fs.readFileSync('src/views/Admin.vue', 'utf8')
const { descriptor } = parse(src)
const result = compileTemplate({ source: descriptor.template.content, id: 'admin', filename: 'Admin.vue' })
const code = result.code
const i = code.indexOf('handleMenuSelect')
console.log('--- handleMenuSelect context ---')
console.log(code.slice(Math.max(0, i - 300), i + 120))
