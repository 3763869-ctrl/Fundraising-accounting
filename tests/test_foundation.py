import sqlite3
import unittest
from fundraising.db import connect, post_journal
from fundraising.app import money


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(':memory:')
        self.db.execute("INSERT INTO organizations VALUES (1,'Charity','USD',CURRENT_TIMESTAMP)")
        self.db.execute("INSERT INTO organizations VALUES (2,'Other','USD',CURRENT_TIMESTAMP)")
        self.db.execute("INSERT INTO accounts VALUES (1,1,'1000','Bank','asset')")
        self.db.execute("INSERT INTO accounts VALUES (2,1,'4000','Donations','income')")
        self.db.execute("INSERT INTO accounts VALUES (3,2,'1000','Other bank','asset')")
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_balanced_journal(self):
        post_journal(self.db, 1, 'Donation received', [(1,1000,0),(2,0,1000)])
        self.assertEqual(self.db.execute('SELECT SUM(debit_minor)-SUM(credit_minor) FROM journal_lines').fetchone()[0], 0)

    def test_unbalanced_journal_rejected(self):
        with self.assertRaises(ValueError):
            post_journal(self.db, 1, 'Invalid', [(1,1000,0),(2,0,999)])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM journals').fetchone()[0], 0)

    def test_cross_organization_posting_rolls_back(self):
        with self.assertRaises(sqlite3.IntegrityError):
            post_journal(self.db, 1, 'Invalid', [(1,1000,0),(3,0,1000)])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM journals').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM journal_lines').fetchone()[0], 0)

    def test_cross_organization_pledge_rejected(self):
        self.db.execute("INSERT INTO donors VALUES (1,2,'Other donor','')")
        self.db.execute("INSERT INTO campaigns VALUES (1,1,'Annual appeal')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) VALUES (1,1,1,1000,'2026-12-01')")

    def test_money_has_no_rounding_loss(self):
        self.assertEqual(money('10.29'), 1029)
        for invalid in ['0','-1','1.001','NaN','Infinity']:
            with self.assertRaises(ValueError):
                money(invalid)


if __name__ == '__main__':
    unittest.main()
