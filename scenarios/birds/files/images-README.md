# Bird photos

`images/` holds one openly licensed photo per bird species (640px wide JPEGs), all from Wikimedia Commons. `images.csv` lists each photo with its author, licence and source. Species with no suitable photo have no row, so check the CSV before you refer to an image.

## Rules for using a photo

- Every time you show a photo on a page, show its `credit_line` from `images.csv` next to it, exactly as written (for example "Photo: Jane Smith, CC BY-SA 4.0, via Wikimedia Commons"). Where you can, link the licence name to `licence_url` and the credit to `source_url`.
- Photos with a licence starting "CC BY-SA" must not be cropped or edited in a published piece. Resizing for display is fine. Do not add filters, overlays or text on top of them.
- Photos under CC BY, CC0 or public domain may be cropped, but still show the `credit_line`.
- Do not claim the photo is ours, and do not swap in a photo for a different species.

## Columns in images.csv

species, scientific_name, file, title (Commons file title), author, licence, licence_url, source_url (Commons file page), credit_line.
