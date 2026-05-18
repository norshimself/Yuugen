import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('shop_items')
export class ShopItem {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  price: number;

  @Column()
  description: string;
}
