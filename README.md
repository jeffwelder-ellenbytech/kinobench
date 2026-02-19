# KinoBench

KinoBench is a no-nonsense hardware workbench web app for talking to real devices over USB Serial and Bluetooth LE.

Direct control without vendor bloat.

## Web App

https://jeffwelder-ellenbytech.github.io/kinobench/

[Developed in the USA, btw]

## Supported Hardware

- Bus Pirate (Web Serial)
- Anker Prime Power series power banks (BLE)
- Anker Prime chargers (BLE)
- Alientek EL15 electronic load (BLE)

## What It Does

- Connect/disconnect to supported hardware from the browser
- Poll live telemetry and view status in real time
- Run device-specific controls (like charger port output toggles)
- Show active BLE connection state directly in the UI tabs

## Local Development

```bash
bun install
bun run dev
```
