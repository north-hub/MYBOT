require('./settings');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const readline = require('readline');
const FileType = require('file-type');
const { exec } = require('child_process');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const PhoneNumber = require('awesome-phonenumber');
const { default: WAConnection, useMultiFileAuthState, Browsers, DisconnectReason, makeInMemoryStore, makeCacheableSignalKeyStore, fetchLatestWaWebVersion, proto, PHONENUMBER_MCC, getAggregateVotesInPollMessage } = require('@whiskeysockets/baileys');

const pairingCode = process.argv.includes('--pairing-code');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '')

const DataBase = require('./src/database');
const database = new DataBase();
(async () => {
	const loadData = await database.read()
	if (loadData && Object.keys(loadData).length === 0) {
		global.db = {
			set: {},
			users: {},
			game: {},
			groups: {},
			database: {},
			...(loadData || {}),
		}
		await database.write(global.db)
	} else {
		global.db = loadData
	}
	
	setInterval(async () => {
		if (global.db) await database.write(global.db)
	}, 30000)
})();

const { GroupUpdate, GroupParticipantsUpdate, MessagesUpsert, Solving } = require('./src/message');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, await, sleep } = require('./lib/function');

async function startBot() {
	const { state, saveCreds } = await useMultiFileAuthState('GT-INFO');
	const { version } = await fetchLatestWaWebVersion()
	const msgRetryCounterCache = new NodeCache()
	const level = pino({ level: 'silent' })
	
	const getMessage = async (key) => {
		if (store) {
			const msg = await store.loadMessage(key.remoteJid, key.id);
			return msg?.message
		}
		return {
			conversation: 'Bot is Actived!'
		}
	}
	
	const Bot = WAConnection({
		version,
		logger: level,
		printQRInTerminal: !pairingCode,
		browser: Browsers.ubuntu('Chrome'),
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, level),
		},
		transactionOpts: {
			maxCommitRetries: 10,
			delayBetweenTriesMs: 10,
		},
		getMessage,
		syncFullHistory: true,
		maxMsgRetryCount: 15,
		msgRetryCounterCache,
		retryRequestDelayMs: 10,
		connectTimeoutMs: 60000,
		keepAliveIntervalMs: 10000,
		defaultQueryTimeoutMs: undefined,
		generateHighQualityLinkPreview: true,
	})
	
	if (pairingCode && !Bot.authState.creds.registered) {
		let phoneNumber;
		async function getPhoneNumber() {
			phoneNumber = await question('[GT-INFO] Enter your number: ');
			phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
			
			if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v)) && !phoneNumber.length < 6) {
				console.log(chalk.bgBlack(chalk.redBright('[GT-INFO]') + chalk.whiteBright(',') + chalk.greenBright(' Ex : 62xxx')));
				await getPhoneNumber()
			}
		}
		
		setTimeout(async () => {
			await getPhoneNumber()
			await exec('rm -rf ./GTINFO/*')
			let code = await Bot.requestPairingCode(phoneNumber);
			console.log(`[GT-INFO] Your Pairing code : ${code}`);
		}, 3000)
	}
	
	store.bind(Bot.ev)
	
	await Solving(Bot, store)
	
	Bot.ev.on('creds.update', saveCreds)
	
	Bot.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect, receivedPendingNotifications } = update
		if (connection === 'close') {
			const reason = new Boom(lastDisconnect?.error)?.output.statusCode
			if (reason === DisconnectReason.connectionLost) {
				console.log('[GT-ONFO] Connection to Server Lost, Attempting to Reconnect...');
				startBot()
			} else if (reason === DisconnectReason.connectionClosed) {
				console.log('[GT-INFO] Connection closed, Attempting to Reconnect...');
				startBot()
			} else if (reason === DisconnectReason.restartRequired) {
				console.log('[GT-INFO] Restart Required...');
				startBot()
			} else if (reason === DisconnectReason.timedOut) {
				console.log('[GT-INFO] Connection Timed Out, Attempting to Reconnect...');
				startBot()
			} else if (reason === DisconnectReason.badSession) {
				console.log('[GT-INFO] Delete Session and Scan again...');
				process.exit(1)
			} else if (reason === DisconnectReason.connectionReplaced) {
				console.log('[GT-INFO] Close current Session first...');
				Bot.logout();
			} else if (reason === DisconnectReason.loggedOut) {
				console.log('[GT-INFO] Scan again and Run...');
				exec('rm -rf ./GTINFO/*')
				process.exit(1)
			} else if (reason === DisconnectReason.Multidevicemismatch) {
				console.log('[GT-INFO] Scan again...');
				exec('rm -rf ./GTINFO/*')
				process.exit(0)
			} else {
				Bot.end(`[GT-INFO] Unknown DisconnectReason : ${reason}|${connection}`)
			}
		}
		if (connection == 'open') {
			console.log('[GT-INFO] Connected to : ' + JSON.stringify(Bot.user, null, 2));
		} else if (receivedPendingNotifications == 'true') {
			console.log('[GT-INFO] Please wait About 1 Minute...')
		}
	});
	
	Bot.ev.on('contacts.update', (update) => {
		for (let contact of update) {
			let id = Bot.decodeJid(contact.id)
			if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
		}
	});
	
	Bot.ev.on('call', async (call) => {
		let botNumber = await Bot.decodeJid(Bot.user.id);
		if (db.set[botNumber].anticall) {
			for (let id of call) {
				if (id.status === 'offer') {
					let msg = await Bot.sendMessage(id.from, { text: `Saat Ini, Kami Tidak
					Dapat Menerima Panggilan ${id.isVideo ? 'Video' : 'Suara'}.\nJika
					@${id.from.split('@')[0]} Memerlukan Bantuan, Silakan Hubungi Owner!`,
					mentions: [id.from]});
					await Bot.sendContact(id.from, global.owner, msg);
					await Bot.rejectCall(id.id, id.from)
				}
			}
		}
	});
	
	Bot.ev.on('groups.update', async (update) => {
		await GroupUpdate(Bot, update, store);
	});
	
	Bot.ev.on('group-participants.update', async (update) => {
		await GroupParticipantsUpdate(Bot, update, store);
	});
	
	Bot.ev.on('messages.upsert', async (message) => {
		MessagesUpsert(Bot, message, store);
	});

	return Bot
}

startBot()

let file = require.resolve(__filename)
fs.watchFile(file, () => {
	fs.unwatchFile(file)
	console.log(chalk.redBright(`Update ${__filename}`))
	delete require.cache[file]
	require(file)
});