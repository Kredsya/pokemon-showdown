/**
 * Headless Battle Runner
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * Provides a CLI for piping commands to a BattleStream and receiving
 * either the default text protocol or a JSON-formatted stream which
 * annotates each message with useful metadata for downstream parsers.
 *
 * @license MIT
 */

import {createWriteStream, readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

import {Streams} from '../lib';
import {BattleStream} from '../sim/battle-stream';
import {Dex} from '../sim/dex';
import {PRNG} from '../sim/prng';
import type {PRNGSeed} from '../sim/prng';
import {Teams} from '../sim/teams';

type LogFormat = 'text' | 'json';
type PlayerSlot = 'p1' | 'p2';

interface CLIOptions {
        debug: boolean;
        'no-catch': boolean;
        'keep-alive': boolean;
        replay: boolean | 'spectator' | undefined;
        'log-format': LogFormat;
        seed?: string;
        'log-file'?: string;
        'p1-team-file'?: string;
        'p2-team-file'?: string;
        'interactive-stdin'?: boolean;
}

const LOG_FORMATS: readonly LogFormat[] = ['text', 'json'];
const PLAYER_SLOTS: readonly PlayerSlot[] = ['p1', 'p2'];

class JsonLogFormatter {
        private currentTurn: number | null = null;
        private battleTimestamp: number | null = null;

        format(message: string) {
                const trimmed = message.trim();
                if (!trimmed || trimmed === '|') return null;

                const timestampSeconds = this.extractTimestamp(trimmed);
                if (timestampSeconds !== null) this.battleTimestamp = timestampSeconds;

                const turn = this.extractTurn(trimmed);
                if (turn !== null) this.currentTurn = turn;

                const player = this.extractPlayer(trimmed);
                const timestamp = this.battleTimestamp !== null
                        ? new Date(this.battleTimestamp * 1000).toISOString()
                        : new Date().toISOString();

                return {
                        message: trimmed,
                        timestamp,
                        turn: this.currentTurn,
                        player,
                } as const;
        }

        private extractTimestamp(message: string) {
                if (!message.startsWith('|t:|')) return null;
                const value = Number(message.slice(4));
                return Number.isFinite(value) ? value : null;
        }

        private extractTurn(message: string) {
                if (!message.startsWith('|')) return null;
                const parts = message.split('|');
                if (parts.length < 3) return null;
                if (parts[1] !== 'turn') return null;
                const value = Number(parts[2]);
                return Number.isFinite(value) ? value : null;
        }

        private extractPlayer(message: string) {
                const match = message.match(/p[1-4]/);
                return match ? match[0] : null;
        }
}

function parseLogFormat(value: unknown): LogFormat {
        if (typeof value !== 'string') return 'text';
        const normalized = value.toLowerCase();
        if (LOG_FORMATS.includes(normalized as LogFormat)) {
                return normalized as LogFormat;
        }
        console.error(`Unknown log format "${value}". Supported formats: ${LOG_FORMATS.join(', ')}.`);
        process.exit(1);
}

function parseReplayOption(value: unknown): boolean | 'spectator' | undefined {
        if (value === undefined) return undefined;
        if (typeof value === 'string') {
                if (!value) return true;
                if (value === 'spectator') return 'spectator';
                return true;
        }
        if (typeof value === 'boolean') return value;
        return undefined;
}

function parseSeed(value: unknown): PRNGSeed | null {
        if (value === undefined) return null;
        if (typeof value !== 'string') {
                console.error('Seed must be provided as a string.');
                process.exit(1);
        }
        const trimmed = value.trim();
        if (!trimmed) {
                console.error('Seed cannot be an empty string.');
                process.exit(1);
        }
        if (trimmed.toLowerCase() === 'random') return PRNG.generateSeed();
        try {
                const prng = new PRNG(trimmed as PRNGSeed);
                return prng.startingSeed;
        } catch (err) {
                console.error(`Invalid seed "${value}".`);
                console.error(err instanceof Error ? err.message : err);
                process.exit(1);
        }
}

function openLogFile(path: string) {
        if (!path) {
                console.error('Log file path cannot be empty.');
                process.exit(1);
        }
        const stream = createWriteStream(path, {flags: 'w'});
        stream.on('error', err => {
                console.error(`Failed to write log output to ${path}:`, err);
                process.exit(1);
        });
        return stream;
}

function loadTeamFromFile(path: string, slot: PlayerSlot) {
        const trimmed = path.trim();
        if (!trimmed) {
                console.error(`Team file path for ${slot.toUpperCase()} cannot be empty.`);
                process.exit(1);
        }
        let contents: string;
        try {
                contents = readFileSync(trimmed, 'utf8');
        } catch (err) {
                console.error(`Failed to read team file for ${slot.toUpperCase()} at ${trimmed}.`);
                console.error(err instanceof Error ? err.message : err);
                process.exit(1);
        }
        const imported = Teams.import(contents);
        if (!imported || !imported.length) {
                console.error(`Team file for ${slot.toUpperCase()} is empty or invalid.`);
                process.exit(1);
        }
        const packed = Teams.pack(imported);
        if (!packed) {
                console.error(`Failed to serialize team file for ${slot.toUpperCase()}.`);
                process.exit(1);
        }
        return packed;
}

async function pipeInputWithTeams(stream: BattleStream, teams: Partial<Record<PlayerSlot, string>>) {
        const input = Streams.stdin();
        const teamHandled: Record<PlayerSlot, boolean> = {
                p1: !teams.p1,
                p2: !teams.p2,
        };
        let pendingInjection = false;

        const injectTeams = () => {
                for (const slot of PLAYER_SLOTS) {
                        if (!teams[slot] || teamHandled[slot]) continue;
                        stream.write(`>player ${slot} ${JSON.stringify({team: teams[slot]})}\n`);
                        teamHandled[slot] = true;
                }
        };

        const handleLine = (line: string, hadNewline: boolean) => {
                if (line.startsWith('>start')) {
                        teamHandled.p1 = !teams.p1;
                        teamHandled.p2 = !teams.p2;
                        pendingInjection = true;
                }
                if (line.startsWith('>player p1 ')) teamHandled.p1 = true;
                if (line.startsWith('>player p2 ')) teamHandled.p2 = true;

                stream.write(hadNewline ? `${line}\n` : line);
        };

        try {
                let buffer = '';
                for await (const chunk of input) {
                        buffer += chunk;
                        let newlineIndex = buffer.indexOf('\n');
                        while (newlineIndex !== -1) {
                                const line = buffer.slice(0, newlineIndex);
                                buffer = buffer.slice(newlineIndex + 1);
                                handleLine(line, true);
                                newlineIndex = buffer.indexOf('\n');
                        }
                        if (pendingInjection) {
                                injectTeams();
                                pendingInjection = false;
                        }
                }
                if (buffer.length) {
                        handleLine(buffer, false);
                }
                if (pendingInjection) injectTeams();
        } finally {
                await stream.writeEnd();
        }
}

function main() {
        Dex.includeFormats();

        const parsed = parseArgs({
                options: {
                        debug: {type: 'boolean', default: false},
                        'no-catch': {type: 'boolean', default: false},
                        'keep-alive': {type: 'boolean', default: false},
                        replay: {type: 'string'},
                        'log-format': {type: 'string', default: 'text'},
                        seed: {type: 'string'},
                        'log-file': {type: 'string'},
                        'p1-team-file': {type: 'string'},
                        'p2-team-file': {type: 'string'},
                        'interactive-stdin': {type: 'boolean', default: false},
                },
                strict: false,
                allowPositionals: true,
        });

        const values = parsed.values as unknown as Partial<CLIOptions>;
        const logFormat = parseLogFormat(values['log-format']);
        const replay = parseReplayOption(values.replay);
        const seed = parseSeed(values.seed);
        const interactive = !!values['interactive-stdin'];

        const logFile = values['log-file'];
        const output = logFile
                ? new Streams.WriteStream({nodeStream: openLogFile(logFile)})
                : Streams.stdout();

        const teams: Partial<Record<PlayerSlot, string>> = {};
        for (const slot of PLAYER_SLOTS) {
                const optionKey = `${slot}-team-file` as const;
                const teamPath = values[optionKey];
                if (teamPath) teams[slot] = loadTeamFromFile(teamPath, slot);
        }

        if (interactive && (teams.p1 || teams.p2)) {
                console.error('Team file options cannot be combined with --interactive-stdin.');
                process.exit(1);
        }

        const battleStream = new BattleStream({
                debug: !!values.debug,
                noCatch: !!values['no-catch'],
                keepAlive: !!values['keep-alive'],
                replay: replay ?? false,
                seed: seed ?? undefined,
        });

        if (interactive) {
                const input = Streams.stdin();
                void input.pipeTo(battleStream).catch(err => {
                        console.error('Failed to pipe input into BattleStream:', err);
                        process.exitCode = 1;
                });
        } else {
                void pipeInputWithTeams(battleStream, teams).catch(err => {
                        console.error('Failed to pipe input into BattleStream:', err);
                        process.exitCode = 1;
                });
        }

        if (logFormat === 'json') {
                void pipeJsonOutput(battleStream, output).catch(err => {
                        console.error('Failed to write BattleStream output:', err);
                        process.exitCode = 1;
                });
                return;
        }

        void battleStream.pipeTo(output).catch(err => {
                console.error('Failed to write BattleStream output:', err);
                process.exitCode = 1;
        });
}

async function pipeJsonOutput(stream: BattleStream, writer: Streams.WriteStream) {
        const formatter = new JsonLogFormatter();
        for await (const chunk of stream) {
                const lines = chunk.split('\n');
                for (const raw of lines) {
                        if (!raw) continue;
                        const entry = formatter.format(raw);
                        if (!entry) continue;
                        const json = `${JSON.stringify(entry)}\n`;
                        const result = writer.write(json);
                        if (result) await result;
                }
        }
        await writer.writeEnd();
}

void main();
