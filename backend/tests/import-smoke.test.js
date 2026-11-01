import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 守卫：vitest 用 esbuild 转译，不严格校验 ESM 命名导出；
// 例如 `import { foo } from './x.js'` 而 x.js 只有默认导出时，vitest 不报错、Node 原生 ESM 启动即崩。
// 本用例用原生 node 动态 import 入口，专门兜住这类"测试绿、生产崩"的问题。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..')

describe('原生 ESM 导入冒烟', () => {
  it('index.js 能被原生 Node 加载（命名导出必须真实存在）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'))
    const out = execFileSync(
      'node',
      ['--input-type=module', '-e', "await import('./src/index.js'); console.log('IMPORT_OK')"],
      {
        cwd: backendDir,
        env: { ...process.env, DATA_DIR: tmp, DISTRIBUTION_MODE: '1', JWT_SECRET: 'smoke', NODE_NO_WARNINGS: '1' },
        encoding: 'utf8',
        timeout: 30000
      }
    )
    expect(out).toContain('IMPORT_OK')
  })
})
