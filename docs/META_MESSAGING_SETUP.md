# Facebook + Instagram DMs → Conversations: setup guide

The code is shipped and switched off. These steps connect OFG's Facebook Page and
Instagram business account using **OFG's own Meta app**. Do them once, as someone
who is an admin of the Facebook Page **and** of OFG's Meta Business account.

**Time:** about 1 hour for steps 1–5, then **1–4 weeks** for Meta's App Review (step 6).
You can test with your own accounts before the review is approved.

**Quick links**
- Meta apps: https://developers.facebook.com/apps/
- Meta Business settings: https://business.facebook.com/settings/
- Graph API Explorer: https://developers.facebook.com/tools/explorer/
- Access Token Debugger: https://developers.facebook.com/tools/debug/accesstoken/
- Vercel environment variables (OFG project): https://vercel.com/alex-gomez-s-dislabs/optimum-credit/settings/environment-variables

---

## 1. Link Instagram to the Facebook Page

1. In the Instagram app, open OFG's account and make sure it's a **professional (Business)** account.
   How to switch: https://help.instagram.com/502981923235522
2. Connect it to the OFG Facebook Page in Business settings → **Accounts → Instagram accounts**:
   https://business.facebook.com/latest/settings/instagram_account
3. In the Instagram app: **Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages** must be **on**.

## 2. Create the Meta app

1. Open https://developers.facebook.com/apps/ and click **Create app**.
2. Use case: **Other** → app type **Business**. Name it e.g. `OFG Conversations` and choose OFG's Business account.
3. In the app dashboard, add the products **Messenger** and **Instagram** (Instagram API with Facebook Login).
   - Messenger docs: https://developers.facebook.com/docs/messenger-platform/
   - Instagram messaging docs: https://developers.facebook.com/docs/messenger-platform/instagram/

## 3. Get the IDs and tokens

| Value | Where to find it | Vercel variable |
|---|---|---|
| App secret | Your app at https://developers.facebook.com/apps/ → **App settings → Basic → App secret → Show** | `META_APP_SECRET` |
| Page ID | In https://developers.facebook.com/tools/explorer/ select your app, request `pages_show_list`, run `GET me/accounts` and copy the OFG Page's `id` | `META_PAGE_ID` |
| Instagram account ID | Same Explorer: `GET {page-id}?fields=instagram_business_account` and copy that `id` | `META_IG_ACCOUNT_ID` |
| Page access token | Your app → **Messenger → Settings → Access tokens → Generate** for the OFG Page, then make it long-lived: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/ | `META_PAGE_ACCESS_TOKEN` |
| Verify token | Make up a long random string (e.g. from a password generator) | `META_WEBHOOK_VERIFY_TOKEN` |

**Check the Page token:** paste it into https://developers.facebook.com/tools/debug/accesstoken/. It must say **Expires: Never**. A short-lived token will quietly stop replies working after about an hour.

## 4. Turn it on in Vercel (Production)

1. Open https://vercel.com/alex-gomez-s-dislabs/optimum-credit/settings/environment-variables
2. Add the five values from step 3 to **Production**, plus:

   ```
   SOCIAL_DM_INBOX_ENABLED=1
   ```

3. Redeploy (`npm run deploy:prod`). The **Social** tab in Conversations unlocks only when the flag is on **and** the app secret, Page token and verify token are all set.

## 5. Point Meta's webhooks at OFG

Webhook docs: https://developers.facebook.com/docs/messenger-platform/webhooks/

1. In your app → **Messenger → Settings → Webhooks**:
   - Callback URL: `https://www.ofgllc.com/api/webhooks/meta/messaging`
   - Verify token: the same `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe the OFG Page to the fields **messages** and **message_echoes**
2. In your app → **Instagram → Webhooks**: same URL and token; subscribe to **messages**.

Meta calls the URL once to verify it. That only works after step 4 is deployed.

**Test before review:** while the app is in Development mode, only people with a role on the app (Admin, Developer or Tester) can message it. Add your own Facebook and Instagram accounts under your app → **App roles → Roles**, send the OFG Page a DM, and it should appear in **Conversations → Social** within seconds.

## 6. App Review (to receive DMs from the public)

App Review overview: https://developers.facebook.com/docs/app-review/
Permissions reference: https://developers.facebook.com/docs/permissions/

In your app → **App Review → Permissions and features**, request **Advanced Access** for:

- `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`
- `instagram_basic`, `instagram_manage_messages`
- `business_management`
- **Human Agent**: lets staff reply up to 7 days after the customer's last message instead of 24 hours. https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags/

For each one, Meta asks for a short screen recording. Show: a DM arriving in Conversations → Social, a staff member replying, and the reply arriving in Messenger / Instagram.

If Meta asks, complete **Business Verification** for OFG:
https://developers.facebook.com/docs/development/release/business-verification/

When the review is approved, switch the app to **Live** mode (toggle at the top of the app dashboard).

---

## How it behaves

- **New person:** shows up in **Conversations → Social** as a new contact. Spanish messages go to the Spanish owner (Angel) and English to the English owner (Lecca); if no owner is set, it goes to Cesar. Cesar sees every social conversation.
- **Link to client / Create prospect** works as for an unknown texter. After linking, that person's next DMs land on the client's record.
- **Replies:** staff reply from the inbox; text only for now.
  - Within **24 hours** of the customer's last message: normal reply.
  - From **24 hours to 7 days**: sent with Meta's Human Agent tag.
  - **After 7 days:** blocked with a clear message. Ask them to message again, or reach them by text.
- **Replies sent from Meta's own apps** (Business Suite, the Instagram app) are copied into the thread, so nothing is missing.
- **No AI auto-replies** for now. The texting AI can be turned on for social later.
- **Security:** every webhook must carry Meta's signature (made with the app secret); anything unsigned is refused. Duplicate deliveries are ignored.

## Troubleshooting

| Symptom | Check |
|---|---|
| Meta says the callback URL couldn't be verified | `SOCIAL_DM_INBOX_ENABLED=1`, the verify token matches, and you redeployed |
| DMs don't arrive | Page subscribed to `messages`; Instagram "Allow access to messages" is on; in Development mode the sender must have an app role |
| Vercel logs show `invalid signature` | `META_APP_SECRET` doesn't match the app |
| Replies fail with "Meta send failed (190)" | The Page token expired: make a long-lived one and check it in the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) |
| Replies fail with "(10)" or "(200)" | A permission or Human Agent access isn't approved yet ([App Review](https://developers.facebook.com/docs/app-review/)) |
