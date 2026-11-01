import { useLocalSearchParams } from 'expo-router';

import { ModelDetailScreen } from '@/screens/model-detail';

export default function ModelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ModelDetailScreen id={id} />;
}
