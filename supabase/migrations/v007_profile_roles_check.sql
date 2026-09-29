-- v12.45.0 – profiles.role accepts the eight Classic roles (+ org admin, + legacy 'reviewer'); until now the check constraint
-- still only knew admin/creator/reviewer/viewer, so the workspace-role menu in Admin and invites with the new roles failed.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','viewer','editor','approver','tech_approver','compliance_approver','compliance_manager','creator','team_admin','reviewer'));
