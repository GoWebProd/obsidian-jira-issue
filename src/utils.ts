import { IJiraIssueAccountSettings } from "./interfaces/settingsInterfaces"
import { SettingsData } from "./settings"
const colorsys = require('colorsys')

export function getAccountByAlias(alias: string): IJiraIssueAccountSettings {
    if (alias) {
        const account = SettingsData.accounts.find(account => account.alias.toUpperCase() === alias.toUpperCase())
        if (!account) {
            throw new Error(`No accounts found with alias: ${alias}`)
        }
        return account
    } else {
        return null
    }
}

export function getAccountByHost(host: string): IJiraIssueAccountSettings {
    if (host) {
        return SettingsData.accounts.find(account => account.host === host) || null
    } else {
        return null
    }
}

function randomBetween(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

export function getRandomHexColor(): string {
    return colorsys.hslToHex(randomBetween(0, 359), randomBetween(40, 100), randomBetween(45, 75))
}

export function getRandomRGBColor(): { r: number, g: number, b: number } {
    return colorsys.hslToRgb(randomBetween(0, 359), randomBetween(40, 100), randomBetween(45, 75))
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function exponentialBackoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 30000) // max 30s
}

export function parseRetryAfter(header: string): number {
    // Retry-After can be a number of seconds or an HTTP-date
    const seconds = parseInt(header)
    if (!isNaN(seconds)) {
        return seconds * 1000
    }

    const date = new Date(header)
    if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now())
    }

    return 1000 // fallback 1s
}
