#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const file = 'test-results/playwright-results.json'
if (!existsSync(file)) {
  console.log('No Playwright results: host setup may have failed before tests started.')
  process.exit(0)
}
const report = JSON.parse(readFileSync(file, 'utf8'))
function specs(suites) {
  return suites.flatMap(suite => [...suite.specs, ...specs(suite.suites ?? [])])
}
const slowest = specs(report.suites).flatMap(spec => spec.tests.flatMap(test => test.results
  .filter(result => result.status !== 'skipped')
  .map(result => ({ title: `${spec.file}: ${spec.title}`, duration: result.duration }))))
  .sort((a, b) => b.duration - a.duration).slice(0, 10)
const { expected, unexpected, skipped, flaky, duration } = report.stats
const summary = [
  '### Host journey timings',
  '',
  `Duration: ${(duration / 1000).toFixed(1)}s · Passed: ${expected} · Failed: ${unexpected} · Skipped: ${skipped} · Flaky: ${flaky} · Setup errors: ${report.errors.length}`,
  '',
  '| Slowest tests | Seconds |',
  '| --- | ---: |',
  ...slowest.map(test => `| ${test.title.replaceAll('|', '\\|')} | ${(test.duration / 1000).toFixed(1)} |`),
  '',
].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
