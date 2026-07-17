-- Legal documents (markdown) editable via admin / DB
-- Applied: legal_documents table + seed content from OFG extracts

CREATE TABLE IF NOT EXISTS `legal_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content_md` MEDIUMTEXT NOT NULL,
  `source_url` VARCHAR(500) DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_documents_slug` (`slug`),
  CONSTRAINT `fk_legal_documents_admin`
    FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `legal_documents` (`slug`, `title`, `content_md`, `source_url`) VALUES
(
  'terms',
  'Terms of Service',
  '# Terms & Conditions of Optimum Financial Group

> Source: [https://www.optimum-financial-group.com/terms-and-conditions](https://www.optimum-financial-group.com/terms-and-conditions)  
> Extracted for reference in the Optimum Credit app. Official version lives on the OFG website.

Welcome to Optimum Financial Group. By using our credit repair services, you agree to these Terms and Conditions as well as the applicable laws of the state of California. Please read these terms carefully before proceeding with our services.

## Money-Back Guarantee Clause

At Optimum Financial Group, we are committed to providing effective credit repair services. If we are unable to successfully remove a specified negative item from your credit report after three dispute attempts and six months of continuous payments, you may be eligible for a refund under the following conditions:

### 1. Refund Eligibility

- The negative item(s) in question must have been explicitly included in the scope of services agreed upon at the start of the engagement.
- You must have made all required payments to Optimum Financial Group for a minimum of six consecutive months.

### 2. Refund Process

- If we are unable to remove the specified negative item(s) after three dispute attempts, we will calculate your refund by deducting the costs of services rendered from your total payment. The remaining balance will be refunded to you.
- Costs of services rendered include administrative fees, credit analysis, dispute preparation, and any other outlined services provided during the engagement.

### 3. Exclusions

- The money-back guarantee does not apply to situations where removal of negative items is not possible due to the item(s) being verified as accurate, legitimate, or beyond the legal scope of credit repair.
- Refunds will not be issued for disputes unrelated to the specific negative item(s) covered under this guarantee.

### 4. Requesting a Refund

- You must submit a written request for a refund within 30 days of the conclusion of the six-month period.
- Requests should include documentation or communication related to the disputed negative item(s).

This money-back guarantee is designed to ensure transparency and client satisfaction while acknowledging the complexity of credit repair processes.

## Chargeback Waiver Clause

By reading Optimum Financial Group agreement the Client acknowledges and agrees to the following terms regarding payment and chargebacks:

### 1. No Chargeback Policy

- The Client agrees that all payments made to Optimum Financial Group are final and non-refundable, except as explicitly stated in the Money-Back Guarantee clause or other refund terms outlined in this agreement.
- The Client further agrees not to initiate any chargeback, payment dispute, or reversal of fees through their financial institution or payment provider for any reason.

### 2. Acknowledgment of Services Rendered

- The Client acknowledges that Optimum Financial Group provides specialized services, including but not limited to credit analysis, dispute preparation, and other credit repair efforts.
- By signing this agreement, the Client confirms their understanding of the scope of services and accepts responsibility for the agreed-upon fees.

### 3. Dispute Resolution

- Should the Client have concerns or disputes regarding the services provided, they agree to resolve such disputes directly with Optimum Financial Group through the outlined resolution process in this agreement.

### 4. Contractual Evidence

- The Client agrees that this signed agreement, along with records of services rendered, constitutes binding evidence of their consent to the terms and conditions of payment.
- Optimum Financial Group reserves the right to provide this agreement and supporting documentation to payment processors, financial institutions, or legal representatives in the event of an unauthorized chargeback or payment dispute.

### 5. Legal Action for Chargeback Violations

- In the event that a chargeback is initiated in violation of this agreement, the Client may be held liable for all associated fees, legal costs, and damages incurred by Optimum Financial Group.

## Acceptance of Terms & Conditions

By accessing the services of Optimum Financial Group, you agree to comply with all terms and conditions set forth herein. These terms constitute a legally binding agreement between you and Optimum Financial Group.

## Description of Service

Optimum Financial Group provides credit repair services, including but not limited to reviewing and disputing errors on credit reports, financial counseling, and assistance with credit restoration. The services offered are limited to what is allowed under federal and California state laws, including the Credit Repair Organizations Act (CROA) and the Fair Credit Reporting Act (FCRA).

## Client Information

You are responsible for providing accurate and truthful information. Any incorrect or misleading information may affect our ability to deliver effective services. Optimum Financial Group is not responsible for delays or service failures resulting from inaccurate information provided by you.

## Authorization and Consent

By accepting these terms, you grant Optimum Financial Group permission to access and review your credit reports from the major credit bureaus and to contact creditors on your behalf.

## Payment and Fees

Optimum Financial Group charges for services as per the fees agreed upon in the service contract. All fees are final and non-refundable unless otherwise specified in the contract.

## Cancellation and Refunds

You have the right to cancel our services at any time, with written notice, provided the process has not yet commenced. Optimum Financial Group will process cancellation requests in accordance with the cancellation policies outlined in the service contract. Refunds, if applicable, will be handled on a case-by-case basis.

## Applicable Law

These Terms and Conditions will be governed by and interpreted in accordance with the laws of the state of California, without regard to its conflict of law provisions. Any disputes related to our services must be resolved in the courts of Los Angeles County, California.

## Privacy and Security

Optimum Financial Group is committed to protecting your privacy. Any information collected will be used solely for service delivery and will not be shared with third parties without your consent, except as required by law.

## Modification of Terms

Optimum Financial Group reserves the right to modify these Terms and Conditions at any time. We will notify you of significant changes, and continued use of our services after such modifications constitutes acceptance of the updated terms.

## Contact Information

If you have any questions or concerns about these Terms and Conditions, you can contact us at:

- **Address:** 427 East 17th Suite F-#719 Costa Mesa CA 92627
- **Email:** info@optimum-financial-group.com
- **Phone:** (949) 736-5644
',
  'https://www.optimum-financial-group.com/terms-and-conditions'
),
(
  'privacy',
  'Privacy Policy',
  '# Optimum Financial Group — SMS Messaging Service Terms and Conditions

> Source: [https://terms.optimum-financial-group.com/tc-page](https://terms.optimum-financial-group.com/tc-page)  
> **Note:** This page is SMS / messaging terms — not a general privacy policy.  
> Extracted for reference in the Optimum Credit app. Official version lives on the OFG terms subdomain.

### 1. Acceptance of Terms

By using our SMS messaging service, you agree to and accept the terms and conditions described below. If you do not agree with these terms, please do not use our service.

### 2. Service Description

Our SMS messaging service allows users to receive text messages and reminders related to Optimum Financial Group. This service may include, but is not limited to, appointment reminders, promotional notifications, and other relevant communications.

### 3. Consent

By providing your mobile phone number, you consent to receive text messages from Optimum Financial Group. You understand that you are not required to provide consent as a condition of purchasing goods or services.

### 4. Message Frequency

Message frequency may vary. You may receive several messages per month, depending on your interaction with our services and necessary notifications.

### 5. Fees

Optimum Financial Group does not charge for the SMS messaging service; however, standard messaging and data rates from your mobile carrier may apply.

### 6. Service Cancellation

You may opt out of receiving SMS messages at any time by sending the word **STOP** to **(844) 401-9494**. After sending the message "STOP" to (844) 401-9494, you will receive a confirmation message and will no longer receive messages. If you wish to reactivate the service, you can do so by contacting info@optimum-financial-group.com or (844) 401-9494.

### 7. Support

If you need help with our SMS messaging service, you can send the word **HELP** to **(844) 401-9494** or contact us at info@optimum-financial-group.com or (844) 401-9494.

### 8. Privacy

Your privacy is important to us. The information collected through our SMS messaging service is used solely to provide and improve the service. We do not share your information with third parties without your consent, except as required by law or to protect our rights.

### 9. Modifications to Terms

We reserve the right to modify these terms and conditions at any time. Modifications will be effective immediately upon posting on our website. Continued use of the service after any modifications constitutes your acceptance of the new terms.

### 10. Limitation of Liability

Optimum Financial Group will not be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use the SMS messaging service.

### 11. Governing Law

These terms and conditions will be governed and interpreted in accordance with the laws of the USA/CA. Any disputes arising in connection with these terms and conditions will be subject to the exclusive jurisdiction of the courts of the USA/CA.
',
  'https://terms.optimum-financial-group.com/tc-page'
)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `content_md` = VALUES(`content_md`),
  `source_url` = VALUES(`source_url`);
