"use client";
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/Button';
import { useTheme } from '../../lib/useTheme';

interface ProfileSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileSettingsModal({ open, onOpenChange }: ProfileSettingsModalProps) {
  const [theme, , { toggle }] = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Account & Settings</DialogTitle>
          <DialogDescription>Manage your preferences and subscription.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <section className="space-y-1">
            <h3 className="font-medium">Theme</h3>
            <Button variant="outline" onClick={toggle} className="text-xs">
              Toggle to {theme === 'dark' ? 'light' : 'dark'} mode
            </Button>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">Subscription</h3>
            <p className="text-xs text-muted-foreground">Manage Subscription (placeholder)</p>
            <Button size="sm" variant="subtle" disabled>
              Open Billing Portal
            </Button>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">Account</h3>
            <p className="text-xs text-muted-foreground">Danger zone actions (placeholder)</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled>
                Delete Account
              </Button>
              <Button size="sm" variant="outline" disabled>
                Sign Out Everywhere
              </Button>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} autoFocus>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
