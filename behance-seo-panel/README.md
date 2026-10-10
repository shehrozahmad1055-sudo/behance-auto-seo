# Behance SEO Panel (Chrome side-panel extension)

Researches real search keywords for your design, writes a short SEO title, 10 tags and a description, and fills them into the Behance project editor.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Click the extension icon on a Behance page. The side panel opens next to the page.
4. In ⚙️ Settings paste a Gemini API key (https://aistudio.google.com/apikey) and save.

## Use
1. Open your project in the Behance editor (open the project **Settings** drawer so the tags field is visible).
2. In the panel press **Analyze project & generate SEO**. No uploading: it scrolls the page, reads every project image (up to 300 by default), sends them to Gemini in batches of 40, merges the batch summaries into one understanding of the whole project, then does the keyword research. Brand name and brief are optional.
3. Pick one of the 3 titles, edit tags/description if you like, press **Fill on Behance**.
4. Check the preview, then publish yourself (or use the Click Publish button, which asks for confirmation).

## How the keywords are chosen
- Gemini looks at ALL project images (in batches) plus your optional brand/brief and proposes 5-8 seed search phrases for the whole project.
- Each seed is expanded with Google autocomplete (what people really type) and with tags/titles found on the Behance search results page for that seed.
- Gemini then writes the title, tags and description using only that candidate list, within your length limits.

## Editing an existing project
Open the project in the Behance editor (Edit project), then use the same buttons. Keep "replace old tags and creative fields" ticked to clear the old ones first (it presses Backspace inside the empty tag/field inputs only, nothing else is clicked).

## Creative fields (category)
Gemini picks up to 3 fields (Graphic Design, Illustration, UI/UX, Branding, Packaging...). On Fill, the extension types each name into the Creative Fields input in the editor Settings and clicks the matching option from Behance's own dropdown, so only fields that really exist are selected.

## Image tags (each image separately)
Close the Settings drawer, press **Tag all images**. For every image the panel clicks it, reads the short suggested tags Behance shows in the image side panel, ranks them by how well they match your project's keywords and adds 3 to 7 of them (never more than 7). Project tags go in through the Settings/publish window, image tags are separate. If the image panel is not found, press the debug button, paste the copied HTML to Claude, and the selectors can be fixed.

## Limits (what the extension enforces)
- Tags: max 10 per project, each tag max 20 characters (your rule; Behance's own limit is 25) and no `<` `>` or commas. Over-long or illegal tags are dropped and replaced from the researched keyword list.
- Title: Behance does not publish limits. Default 45-75 characters, 5-10 words, must read like a real project title (not a keyword list or 2 words).
- Description: default 200-1000 characters (not officially published).
- Image tags: 3 to 7 per image, each max 20 characters.
- The extension also reads the real `maxlength` of fields from the open editor and reads Behance's error banner after filling; if it says "limited to N characters" the limit is learned and saved.
- All limits are editable in Settings.
- Behance has no public keyword-volume API, so "real keywords" means autocomplete and ranking-page signals, not exact search counts.
- The Behance editor markup changes. If something shows "not found", open the matching Settings section and press Fill again, or use the Copy buttons. Selectors live in `content.js`.
