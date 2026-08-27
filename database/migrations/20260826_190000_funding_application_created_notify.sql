-- Add funding_application_created to Joe Pepe extra-email alerts (manual intake).
UPDATE `admin_notify_extra_emails`
SET `events_json` = JSON_ARRAY('funding_doc_upload', 'funding_application_created')
WHERE `email` = 'joepepe@lexingtoncapitalholdings.com';
