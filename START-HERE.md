# Original automation setup (retained)

For the hosted version, follow README.md for installation and updates. The instructions below describe the original standalone installation; the Wallet automation and widget setup still apply.

# Wallet Counter v0.2.0

Your monthly SEK allowance counts down as you pay with Apple Wallet. All cards can trigger it. Your allowance is editable in the menu. The month resets on the 1st in Europe/Stockholm time, with no rollover. No money is moved.

## 1. Install and set the allowance

1. Install **Scriptable** from https://apps.apple.com/us/app/scriptable/id1405459188.
2. Open `WalletCounter.js` from this package and copy all its text.
3. In Scriptable, tap **+**, paste the text, and name the script **Wallet Counter**.
4. Run it in Scriptable. Enter a temporary monthly SEK allowance. You can change it later without editing the script.
5. Select **Preview widget**. Preview does not require notification permission. Allow Scriptable notifications when capture first requests them, or enable them in Settings.

Start with a small synthetic Shortcut test, then a real shop purchase. No bank login is needed.

## 2. Build the Wallet automation in TEST mode

On your iPhone running iOS 26.6:

1. Open **Shortcuts → Automation → +**.
2. Choose **Transaction** (it may appear under Wallet).
3. Select **your payment cards only**, exclude tickets and loyalty passes, and select **all transaction categories**. Select **Run Immediately**.
4. Create a blank automation. Add **Set Variable**, named `WalletAmount`, with **Shortcut Input → Type: Transaction → Amount** as its value. Add a **Dictionary** action below it with these keys:

| Key | Value | How to configure |
|---|---|---|
| `action` | `test` | Plain text |
| `amount` | Wallet transaction amount | Select the named **WalletAmount** variable, set its type to **Currency Amount**, then select the **lower Currency Amount property** (below Currency Code). Dictionary entry type: Number. |
| `currency` | Wallet currency code | Select the named **WalletAmount** variable, set its type to **Currency Amount**, then select **Currency Code**. Dictionary entry type: Text. |
| `merchant` | Wallet merchant | Select **Merchant** or **Name** from the transaction |

5. Add **Scriptable → Run Script**. Choose **Wallet Counter**. Set its **Parameter** to the Dictionary above. Keep **Run in App** off for background capture. Do not pass the whole transaction as the amount or merchant.
6. Save the automation. UI labels can differ; inspect the available transaction properties instead of assuming an exact label.

**Important:** A Scriptable Dictionary can receive ordinary numbers or strings. If passing Apple's Currency Amount object causes a conversion error, extract its numeric amount first with **Get Numbers from Input**, or format the numeric property as a decimal number without grouping. Pass a single number, not a list. Pass the currency code separately. Do not hardcode SEK in the live automation: your US card may supply a different currency. If there is no usable currency field, stop here and share the available property names so we can adapt safely.

## 3. Confirm the capture path

Before a real purchase, make a separate normal Shortcut with this fixed Dictionary and the same Run Script action:

```json
{"action":"test","amount":12.5,"currency":"SEK","merchant":"Setup test"}
```

Run it while unlocked. You should receive **Wallet capture test passed**. In Scriptable, run Wallet Counter and choose **View capture test** to see the saved fields. The spending total must stay unchanged.

Then make one normal small shop purchase using your iPhone. Lock the phone immediately afterwards. Check the test notice or **View capture test**. Verify amount, currency and merchant against the receipt. Repeat with your second Capital One card. Test entries never count as spending.

If the automation asks to unlock, verify its privacy permissions and background setting. Run the actions manually while unlocked to grant first-use permissions. Do not enable Run in App as a workaround without accepting that it may open Scriptable or require unlocking.

**Only after both cards work:** change the Dictionary's `action` value from `test` to **`capture`**. Test one live purchase. Run Wallet Counter and confirm exactly one purchase appears and the balance falls by the right amount.

If Wallet supplies USD for a Swedish purchase, the script estimates SEK from that USD amount. This estimate can differ from the receipt. Correct it under Recent purchases when needed.

## 4. Add the widget

1. Long-press the iPhone Home Screen and add a **Scriptable** widget.
2. Choose **small or medium**; medium is the recommended size.
3. Edit the widget and select **Wallet Counter** as its script.
4. Leave its parameter empty. Tapping it opens the management menu.

The bar shows the share of your allowance remaining. The script requests a refresh after 15 minutes, but iOS decides the actual redraw time. **Rendered HH:MM** is the time the displayed view was calculated, not proof that every purchase was captured. Purchase notifications show the new counter sooner, subject to notification permissions and Focus settings.

## 5. Day-to-day use

- **Change allowance:** applies to this month plus future months, or next month onward. Previous targets stay recorded.
- **Add purchase / opening spend:** enter SEK spending outside Wallet, or spending before setup. A lump-sum opening entry belongs to the current month.
- **Add refund:** restores that amount to the current month's allowance. The first version does not allocate refunds back to an earlier month automatically.
- **Recent purchases / corrections:** inspect the latest 25 active entries, correct their SEK amount, mark a suspected duplicate reviewed, or undo an entry. Export includes the full history.
- **Monthly history:** shows recorded spending and targets.
- **Export backup:** saves a JSON export through the share sheet. It includes transaction details; choose where to save it deliberately.
- **Toggle purchase notifications:** disables ordinary success notices. Foreign-currency and possible-duplicate warnings remain on.

Refunds can make the balance exceed the monthly allowance. Spending past the limit produces a negative balance. Changing the target does not clear spending. Foreign purchases use automatic SEK estimates as described below. No bank connection is included.

## Upgrade from v0.1.0 and foreign currencies

1. Open your existing **Wallet Counter** script in Scriptable.
2. Replace all its code with `WalletCounter.js` from this package. Keep the script name **Wallet Counter**.
3. Do not delete Scriptable or create a different widget script. The same local storage paths preserve the allowance and purchases. No Shortcut changes are required.
4. Run Wallet Counter and choose **Refresh exchange rates** while online. This also preloads EUR, GBP, USD and other supported ECB currencies for offline use. Allow a network permission prompt if one appears.
5. The dialog should list EUR/GBP/USD as ready. The next foreign purchase is deducted as an estimated SEK amount.

- Free Frankfurter API, no account or API key. Rates are ECB daily reference rates, not live trading or card settlement rates. Amounts and merchants are never sent to the API.
- A cache fetched within 12 hours is reused. Otherwise a refresh is attempted, with a 5-second request idle timeout. If that fails, a cached rate dated within 7 days may be used. A first-time offline purchase without a rate remains pending for manual SEK correction.
- The purchase is saved before the network lookup. Unsupported currencies, bad rates or an interrupted lookup leave an entry to review rather than discarding it or treating foreign units as SEK.
- Each automatic conversion stores its rate and date. It stays fixed; later rate updates do not change past purchases. The widget labels totals containing estimates, and Recent purchases marks them with ≈.
- To replace an estimate with an exact amount, choose **Recent purchases / corrections → purchase → Set / correct SEK amount**. This replaces the counted amount rather than adding another purchase.
- Existing unconverted purchases are not automatically backfilled by this upgrade. Enter their SEK amounts manually. Widget refresh does not fetch rates or change transactions.

## Limits and recovery

- Supported iPhone Wallet taps are the initial scope. Online/app Apple Pay, physical-card payments, Apple Watch payments, recurring charges, invoices and historic Wallet transactions are not assumed to be captured. Device tests determine coverage.
- Apple sometimes runs the automation without supplying usable Wallet fields. When amount is zero/missing and currency, merchant and name are all blank, Wallet Counter asks whether the tap was SL and deducts nothing until you choose Yes. If the automation does not run at all, the script cannot detect the missed trigger. Keep comparing captures with receipts during the trial.
- Outside that all-empty fallback, amount and currency must validate. Partially populated or malformed input still fails visibly; it is never guessed into an SL fare or zero-value purchase.
- Two identical Wallet entries within 90 seconds are flagged but both remain counted. Review them to distinguish a retry from two genuine purchases.
- Captures have separate local event files, so simultaneous captures do not overwrite one shared transaction list. Corrections retain an audit trail. Month reset is a calendar calculation, not a midnight background job.
- Local storage has no iCloud sync or automatic cloud backup. Export periodically. Removing Scriptable can remove its data. Backup restore is not implemented in this first version; keep exports for recovery or future import.
- An unreadable transaction file causes an error instead of silently showing an inflated balance. Do not delete files to dismiss that error.
- The code has been tested in Node with a simulated Scriptable environment. Native iPhone execution, actual Wallet input and widget appearance still require your device test.

## Later scope

Monarch backfill and email purchase capture can be added after this path works. Email invoices alone are not proof of a completed charge; future matching must handle cancellations, refunds and orders paid through Wallet to avoid double counting.

## Sources

- Apple transaction trigger: https://support.apple.com/en-euro/guide/shortcuts/apd65c67538a/ios
- Automatic transaction execution: https://support.apple.com/en-in/guide/shortcuts/apd602971e63/ios
- Scriptable Shortcut inputs: https://docs.scriptable.app/args/
- Scriptable local files: https://docs.scriptable.app/filemanager/
- Scriptable widget timing: https://docs.scriptable.app/listwidget/
- Currency field mapping example: https://splitsies.dev/articles/2026-06-27-capture-payments-shortcut

Developer check: run `node test-counter.cjs` to check the calculation and capture logic.

- Exchange rate API: https://frankfurter.dev/
