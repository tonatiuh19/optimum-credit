-- ============================================================================
-- Support FAQ table
-- Allows admins to manage FAQ items shown on the client support page
-- ============================================================================

CREATE TABLE IF NOT EXISTS `support_faq` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `question` VARCHAR(512) NOT NULL,
  `answer` MEDIUMTEXT NOT NULL,
  `category` ENUM('billing','documents','process','technical','general') NOT NULL DEFAULT 'general',
  `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_faq_active_order` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed with initial FAQ items
INSERT INTO `support_faq` (`question`, `answer`, `category`, `sort_order`) VALUES
('How long does the credit repair process take?', 'The credit repair process typically takes 3–6 months depending on the number of items being disputed and bureau response times. Each dispute round runs approximately 30–45 days.', 'process', 1),
('How do I upload my credit reports?', 'Go to the Documents section in your portal. Click "Upload Documents", select the document type (e.g. Credit Report), and attach your PDF or image file. We accept files up to 20 MB.', 'documents', 2),
('What is Smart Credit monitoring and do I need it?', 'Smart Credit is a three-bureau credit monitoring service we use to pull your latest scores and track changes after every dispute round. Connecting it is strongly recommended so we can measure your progress accurately.', 'process', 3),
('When will I be billed and how much?', 'Your billing schedule and amount are defined in your service agreement. You can view payment history in the Payments section of your portal. For billing questions specific to your plan, open a Billing support ticket.', 'billing', 4),
('Can I cancel my service?', 'Yes. Please open a support ticket with the subject "Cancellation Request" and our team will walk you through the process and any applicable terms.', 'billing', 5),
('My document upload failed — what should I do?', 'Make sure the file is under 20 MB and in PDF, JPG, or PNG format. If the problem persists, try a different browser or device, then open a Technical support ticket with a description of the error message you see.', 'technical', 6),
('How do I know if a dispute was successful?', 'After each round, your admin will post a Progress Report in your Reports section showing which items were removed or updated. You will also receive an SMS or email notification.', 'process', 7),
('I see a charge I don''t recognize — what do I do?', 'Open a Billing support ticket and include the transaction date and amount. Our team will investigate and respond within 1 business day.', 'billing', 8);
