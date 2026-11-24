import { Card, Empty, Screen, Text } from '../../ui/primitives';

export default function Meetings() {
  return (
    <Screen>
      <Text variant="h1">Совещания</Text>
      <Card>
        <Empty title="Раздел готовится" text="Назначение и архив совещаний появятся здесь." />
      </Card>
    </Screen>
  );
}
