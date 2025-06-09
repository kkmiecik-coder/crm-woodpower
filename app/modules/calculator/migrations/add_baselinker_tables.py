
"""
Dodaje tabele dla modułu Baselinker

Revision ID: add_baselinker_tables
Create Date: 2025-06-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

def upgrade():
    # Tabela logów Baselinker
    op.create_table('baselinker_order_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('quote_id', sa.Integer(), nullable=False),
        sa.Column('baselinker_order_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('request_data', sa.Text(), nullable=True),
        sa.Column('response_data', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['quote_id'], ['quotes.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Tabela konfiguracji Baselinker
    op.create_table('baselinker_config',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('config_type', sa.String(length=50), nullable=False),
        sa.Column('baselinker_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Indeksy
    op.create_index('ix_baselinker_config_type', 'baselinker_config', ['config_type'], unique=False)
    op.create_index('ix_baselinker_logs_quote', 'baselinker_order_logs', ['quote_id'], unique=False)

def downgrade():
    op.drop_index('ix_baselinker_logs_quote', table_name='baselinker_order_logs')
    op.drop_index('ix_baselinker_config_type', table_name='baselinker_config')
    op.drop_table('baselinker_config')
    op.drop_table('baselinker_order_logs')