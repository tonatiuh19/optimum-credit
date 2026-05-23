-- Migration: Add admin_notes column to clients table
-- Allows admins to attach internal notes to each client record.

ALTER TABLE `clients`
  ADD COLUMN `admin_notes` TEXT DEFAULT NULL
    COMMENT 'Internal notes visible only to admins'
  AFTER `status`;
